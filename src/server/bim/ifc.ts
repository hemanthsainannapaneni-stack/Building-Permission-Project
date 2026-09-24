import { unzipSync } from 'fflate';
import type { IfcFacts, IfcStorey } from '@/lib/bim';

/**
 * Reads the facts a permit review needs out of an IFC file.
 *
 * ── Why the server reads the model at all ──────────────────────────────
 *
 * The BIM tab asks the LTP for the schema, the storeys and the
 * georeferencing. If the only evidence were their answers, a BIM submission
 * would be a PDF with extra typing. Reading the file means the header's
 * schema, the storeys actually modelled, whether IfcSpace objects exist and
 * whether an IfcMapConversion places the model on the earth all come from the
 * bytes — and the readiness check compares the two.
 *
 * ── What this is not ───────────────────────────────────────────────────
 *
 * It is not a geometry engine. It reads the STEP physical file (ISO 10303-21)
 * as text: the header, every entity's type, and the attributes of the
 * handful of entities whose values are plain data (storeys, site, units, map
 * conversion). Areas and heights come from the authoring tool's schedules,
 * entered on the tab and reconciled — computing them from B-reps is a
 * scrutiny engine's job, not an upload handler's.
 *
 * Pure: no database, no storage. The service calls it on the bytes it is
 * about to store, and the tests call it on a string.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Entry points
// ═══════════════════════════════════════════════════════════════════════════

/** Reads an .ifc or .ifczip buffer. Never throws — a bad file is a fact too. */
export function readIfc(bytes: Buffer, extension: string): IfcFacts {
  try {
    if (extension.toLowerCase() === 'ifczip') {
      const entries = unzipSync(new Uint8Array(bytes), {
        filter: (f) => f.name.toLowerCase().endsWith('.ifc'),
      });
      const first = Object.values(entries)[0];
      if (!first) return failed('IFC_ZIP', 'The .ifczip archive contains no .ifc file.');
      return { ...parseIfcText(Buffer.from(first).toString('utf8')), format: 'IFC_ZIP' };
    }
    return parseIfcText(bytes.toString('utf8'));
  } catch (error) {
    return failed(
      extension.toLowerCase() === 'ifczip' ? 'IFC_ZIP' : 'IFC_STEP',
      error instanceof Error ? `The model could not be read: ${error.message}` : 'The model could not be read.'
    );
  }
}

export function parseIfcText(text: string): IfcFacts {
  const facts = empty('IFC_STEP');

  const headerStart = text.indexOf('HEADER;');
  const dataStart = text.indexOf('DATA;');
  if (!/^\s*(﻿)?ISO-10303-21;/.test(text) || headerStart === -1 || dataStart === -1) {
    return failed('IFC_STEP', 'This is not an IFC STEP file — it has no ISO-10303-21 header and DATA section.');
  }

  // ── Header ────────────────────────────────────────────────────────────
  const header = text.slice(headerStart, dataStart);
  for (const stmt of statements(header)) {
    const open = stmt.indexOf('(');
    if (open === -1) continue;
    const name = stmt.slice(0, open).trim().toUpperCase();
    const args = parseArgs(stmt.slice(open));

    if (name === 'FILE_DESCRIPTION') {
      const descriptions = asList(args[0]).map(asString);
      const view = descriptions.map((d) => /ViewDefinition\s*\[([^\]]*)\]/i.exec(d)?.[1]).find(Boolean);
      facts.viewDefinition = (view ?? '').split(',')[0]!.trim();
    } else if (name === 'FILE_NAME') {
      facts.timeStamp = asString(args[1]);
      facts.author = asList(args[2]).map(asString).filter(Boolean).join(', ');
      facts.organization = asList(args[3]).map(asString).filter(Boolean).join(', ');
      facts.preprocessor = asString(args[4]);
      facts.originatingSystem = asString(args[5]);
    } else if (name === 'FILE_SCHEMA') {
      facts.schema = asList(args[0]).map(asString)[0] ?? '';
    }
  }

  // ── Data ──────────────────────────────────────────────────────────────
  const entities = new Map<number, { type: string; args: Arg[] | null; raw: string }>();
  const body = text.slice(dataStart + 'DATA;'.length);

  for (const stmt of statements(body)) {
    const match = /^#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*(\(.*)$/s.exec(stmt);
    if (!match) continue;
    const type = match[2]!.toUpperCase();
    facts.entityCount += 1;

    const counted = countedType(type);
    facts.counts[counted] = (facts.counts[counted] ?? 0) + 1;

    // Only the entities whose attributes are read are parsed. Parsing every
    // IfcCartesianPoint in a 20 MB model would be most of the work for none
    // of the answer.
    entities.set(Number(match[1]), {
      type,
      raw: match[3]!,
      args: PARSED.has(type) ? parseArgs(match[3]!) : null,
    });
  }

  if (!facts.entityCount) return failed('IFC_STEP', 'The DATA section contains no entities.');

  // ── Units: the length unit decides how every elevation is read ────────
  let lengthScale = 1;
  facts.lengthUnit = 'METRE';
  for (const e of entities.values()) {
    if (e.type === 'IFCSIUNIT' && e.args && asEnum(e.args[1]) === 'LENGTHUNIT') {
      const prefix = asEnum(e.args[2]);
      lengthScale = SI_PREFIX[prefix] ?? 1;
      facts.lengthUnit = `${prefix === 'MILLI' ? 'MILLI' : prefix === 'CENTI' ? 'CENTI' : ''}METRE`;
      break;
    }
    if (e.type === 'IFCCONVERSIONBASEDUNIT' && e.args && asEnum(e.args[1]) === 'LENGTHUNIT') {
      facts.lengthUnit = asString(e.args[2]).toUpperCase() || 'CONVERSION_BASED';
      lengthScale = /FOOT|FEET/i.test(facts.lengthUnit) ? 0.3048 : /INCH/i.test(facts.lengthUnit) ? 0.0254 : 1;
      break;
    }
  }

  // ── Spatial structure ─────────────────────────────────────────────────
  const storeys: IfcStorey[] = [];
  for (const e of entities.values()) {
    if (!e.args) continue;
    if (e.type === 'IFCPROJECT' && !facts.projectName) {
      // Name, then LongName (attribute 6 of IfcProject).
      facts.projectName = asString(e.args[2]) || asString(e.args[5]);
    } else if (e.type === 'IFCBUILDING' && !facts.buildingName) {
      facts.buildingName = asString(e.args[2]);
    } else if (e.type === 'IFCSITE' && !facts.siteName) {
      facts.siteName = asString(e.args[2]);
      facts.georef.refLatitude = compoundAngle(e.args[9]);
      facts.georef.refLongitude = compoundAngle(e.args[10]);
      const elevation = asNumber(e.args[11]);
      facts.georef.refElevation = elevation === null ? null : round(elevation * lengthScale, 3);
    } else if (e.type === 'IFCBUILDINGSTOREY' && asEnum(e.args[8]) !== 'PARTIAL') {
      // A PARTIAL storey is a mezzanine inside another one, not a floor.
      const elevation = asNumber(e.args[9]);
      storeys.push({
        name: asString(e.args[2]) || asString(e.args[7]) || 'Unnamed storey',
        elevationM: elevation === null ? null : round(elevation * lengthScale, 3),
      });
    } else if (e.type === 'IFCMAPCONVERSION') {
      facts.georef.hasMapConversion = true;
      facts.georef.eastings = asNumber(e.args[2]);
      facts.georef.northings = asNumber(e.args[3]);
      facts.georef.orthogonalHeight = asNumber(e.args[4]);
    } else if (e.type === 'IFCPROJECTEDCRS' && !facts.georef.crsName) {
      facts.georef.crsName = asString(e.args[0]);
    }
  }

  facts.storeys = storeys.sort((a, b) => (a.elevationM ?? 0) - (b.elevationM ?? 0));
  facts.parsed = true;
  return facts;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP tokenising
// ═══════════════════════════════════════════════════════════════════════════

const PARSED = new Set([
  'IFCPROJECT',
  'IFCSITE',
  'IFCBUILDING',
  'IFCBUILDINGSTOREY',
  'IFCSIUNIT',
  'IFCCONVERSIONBASEDUNIT',
  'IFCMAPCONVERSION',
  'IFCPROJECTEDCRS',
]);

const SI_PREFIX: Record<string, number> = { '': 1, MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 };

/**
 * Subtypes counted under the type an officer thinks in. An
 * IfcWallStandardCase is a wall; reporting "0 walls" for a Revit export that
 * only writes standard cases would be true and useless.
 */
function countedType(type: string): string {
  return type.replace(/(STANDARDCASE|ELEMENTEDCASE)$/, '');
}

/**
 * Splits STEP text into statements at top-level semicolons, ignoring any
 * inside a string ('' is an escaped quote) or a comment.
 */
function* statements(text: string): Generator<string> {
  let start = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (ch === 39 /* ' */) {
        if (text.charCodeAt(i + 1) === 39) i += 1;
        else inString = false;
      }
      continue;
    }
    if (ch === 39) {
      inString = true;
    } else if (ch === 47 /* / */ && text.charCodeAt(i + 1) === 42 /* * */) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (ch === 59 /* ; */) {
      const stmt = text.slice(start, i).trim();
      if (stmt) yield stmt;
      start = i + 1;
    }
  }
}

type Arg =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'enum'; v: string }
  | { t: 'ref'; v: number }
  | { t: 'list'; v: Arg[] }
  | { t: 'typed'; type: string; v: Arg[] }
  | { t: 'null' };

/** Parses "(a,b,(c,d),IFCLABEL('x'))" into its arguments. */
function parseArgs(src: string): Arg[] {
  let i = 0;

  const skip = () => {
    while (i < src.length && /\s/.test(src[i]!)) i += 1;
  };

  const value = (): Arg => {
    skip();
    const ch = src[i];
    if (ch === '(') return { t: 'list', v: list() };
    if (ch === "'") {
      let out = '';
      i += 1;
      while (i < src.length) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            out += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        out += src[i];
        i += 1;
      }
      return { t: 'str', v: decodeStepString(out) };
    }
    if (ch === '$' || ch === '*') {
      i += 1;
      return { t: 'null' };
    }
    if (ch === '#') {
      const m = /^#(\d+)/.exec(src.slice(i));
      i += m ? m[0].length : 1;
      return { t: 'ref', v: m ? Number(m[1]) : 0 };
    }
    if (ch === '.') {
      const end = src.indexOf('.', i + 1);
      const v = src.slice(i + 1, end);
      i = end + 1;
      return { t: 'enum', v: v.toUpperCase() };
    }
    const num = /^[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return { t: 'num', v: Number(num[0]) };
    }
    const typed = /^([A-Za-z0-9_]+)\s*\(/.exec(src.slice(i));
    if (typed) {
      i += typed[1]!.length;
      skip();
      return { t: 'typed', type: typed[1]!.toUpperCase(), v: list() };
    }
    // Unknown token: consume to the next separator rather than loop forever.
    while (i < src.length && src[i] !== ',' && src[i] !== ')') i += 1;
    return { t: 'null' };
  };

  const list = (): Arg[] => {
    const out: Arg[] = [];
    i += 1; // (
    skip();
    if (src[i] === ')') {
      i += 1;
      return out;
    }
    while (i < src.length) {
      out.push(value());
      skip();
      if (src[i] === ',') {
        i += 1;
        continue;
      }
      if (src[i] === ')') {
        i += 1;
        break;
      }
      i += 1;
    }
    return out;
  };

  skip();
  return src[i] === '(' ? list() : [];
}

/** Decodes the \X2\…\X0\ and \X\hh escapes exporters use for non-ASCII names. */
function decodeStepString(s: string): string {
  return s
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, hex: string) =>
      (hex.match(/.{4}/g) ?? []).map((h) => String.fromCharCode(parseInt(h, 16))).join('')
    )
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128));
}

const asString = (a: Arg | undefined): string =>
  !a ? '' : a.t === 'str' ? a.v : a.t === 'typed' ? asString(a.v[0]) : '';

const asNumber = (a: Arg | undefined): number | null =>
  !a ? null : a.t === 'num' ? a.v : a.t === 'typed' ? asNumber(a.v[0]) : null;

const asEnum = (a: Arg | undefined): string => (a?.t === 'enum' ? a.v : '');

const asList = (a: Arg | undefined): Arg[] => (a?.t === 'list' ? a.v : a ? [a] : []);

/** IfcCompoundPlaneAngleMeasure: (degrees, minutes, seconds, millionths). */
function compoundAngle(a: Arg | undefined): number | null {
  const parts = asList(a).map(asNumber);
  if (!parts.length || parts[0] === null) return null;
  const [d = 0, m = 0, s = 0, u = 0] = parts.map((p) => p ?? 0);
  return round(d + m / 60 + s / 3600 + u / 3_600_000_000, 7);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function empty(format: IfcFacts['format']): IfcFacts {
  return {
    parsed: false,
    format,
    schema: '',
    viewDefinition: '',
    originatingSystem: '',
    preprocessor: '',
    author: '',
    organization: '',
    timeStamp: '',
    lengthUnit: '',
    projectName: '',
    siteName: '',
    buildingName: '',
    storeys: [],
    counts: {},
    entityCount: 0,
    georef: {
      hasMapConversion: false,
      crsName: '',
      eastings: null,
      northings: null,
      orthogonalHeight: null,
      refLatitude: null,
      refLongitude: null,
      refElevation: null,
    },
  };
}

function failed(format: IfcFacts['format'], error: string): IfcFacts {
  return { ...empty(format), error };
}
