import 'server-only';

/**
 * Content sniffing by magic bytes.
 *
 * ── Why this exists ────────────────────────────────────────────────────
 *
 * A filename extension and a declared MIME type are BOTH supplied by whoever
 * is uploading. Checking them proves the uploader spelled things consistently,
 * which is not a security property. The first bytes of a file are not under
 * their control in the same way — the file has to actually be what it claims
 * for anything downstream to open it.
 *
 * So step 4 of the pipeline (docs P.3) reads the header and requires it to
 * AGREE with the declared type. A PE binary named `plan.pdf` and served as
 * `application/pdf` dies here.
 *
 * This is a targeted sniffer for the formats this system accepts, not a
 * general-purpose one. That is deliberate: an allow-list of known signatures
 * fails closed on anything unrecognised, where a broad library fails open by
 * returning "probably fine".
 */

export type SniffedKind = 'pdf' | 'dwg' | 'dxf' | 'ifc' | 'png' | 'jpeg' | 'zip' | null;

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

/**
 * Identifies the file from its header, or null when nothing matches.
 *
 * Null is a REFUSAL, not an "unknown, allow it" — see assertContentMatches.
 */
export function sniff(buf: Buffer): SniffedKind {
  // %PDF-
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';

  // \x89PNG\r\n\x1a\n
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';

  // JPEG SOI
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';

  // PK\x03\x04 — also the container for modern Office formats.
  if (
    startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buf, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return 'zip';
  }

  // IFC (and any STEP physical file): "ISO-10303-21;" at the very start,
  // optionally after a UTF-8 byte-order mark or whitespace.
  if (/^(\uFEFF)?\s*ISO-10303-21;/.test(buf.subarray(0, 64).toString('utf8'))) return 'ifc';

  // Binary DXF: "AutoCAD Binary DXF\r\n\x1a\x00"
  if (buf.subarray(0, 18).toString('binary') === 'AutoCAD Binary DXF') return 'dxf';

  // DWG: an ASCII version stamp at offset 0 — AC1012 … AC1032, and the older
  // AC1.50 / AC2.10 forms.
  const stamp = buf.subarray(0, 6).toString('binary');
  if (/^AC[0-9]{1}[0-9.]{3}$/.test(stamp) || /^AC10[0-9]{2}$/.test(stamp)) return 'dwg';

  // ASCII DXF has no magic number. It is a tagged text format that opens with
  // a group code 0 followed by SECTION, usually after leading whitespace.
  // Checking the first 1 KB for that shape is the best available signal, and
  // it still refuses a binary payload renamed to .dxf.
  const head = buf.subarray(0, 1024).toString('latin1');
  if (/^[\s\r\n]*0[\r\n]+\s*SECTION/.test(head)) return 'dxf';
  // Some exporters lead with a comment (group code 999).
  if (/^[\s\r\n]*999[\r\n]/.test(head) && head.includes('SECTION')) return 'dxf';

  return null;
}

/**
 * Which sniffed kinds a declared MIME type is allowed to be.
 *
 * CAD MIME types are reported inconsistently by browsers and operating
 * systems — the same .dwg arrives as `application/acad`, `image/vnd.dwg` or
 * `application/octet-stream` depending on the machine. So the DECLARED type is
 * treated as a weak hint and the sniff is what decides; `octet-stream` is
 * accepted as "unspecified" and matched against any of the CAD kinds.
 */
const DECLARED_TO_KINDS: Record<string, SniffedKind[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpeg'],
  'image/jpg': ['jpeg'],
  'application/zip': ['zip'],
  'application/x-zip-compressed': ['zip'],
  'application/octet-stream': ['pdf', 'dwg', 'dxf', 'ifc', 'png', 'jpeg', 'zip'],
  // Browsers mostly send .ifc as octet-stream or text/plain; the sniff decides.
  'application/x-step': ['ifc'],
  'model/ifc': ['ifc'],
  'application/ifc': ['ifc'],
  'text/plain': ['ifc'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['zip'],
  'image/vnd.dwg': ['dwg'],
  'image/x-dwg': ['dwg'],
  'application/acad': ['dwg'],
  'application/x-acad': ['dwg'],
  'application/autocad_dwg': ['dwg'],
  'application/dwg': ['dwg'],
  'application/x-dwg': ['dwg'],
  'drawing/x-dwg': ['dwg'],
  'application/dxf': ['dxf'],
  'application/x-dxf': ['dxf'],
  'image/vnd.dxf': ['dxf'],
};

/** Which sniffed kinds an extension may legitimately be. */
const EXTENSION_TO_KINDS: Record<string, SniffedKind[]> = {
  pdf: ['pdf'],
  dwg: ['dwg'],
  dxf: ['dxf'],
  png: ['png'],
  jpg: ['jpeg'],
  jpeg: ['jpeg'],
  zip: ['zip'],
  ifc: ['ifc'],
  // Zip containers by another name: a compressed IFC, a BCF issue set and a
  // COBie workbook are all PK archives.
  ifczip: ['zip'],
  bcf: ['zip'],
  bcfzip: ['zip'],
  xlsx: ['zip'],
};

export type ContentCheck =
  | { ok: true; kind: NonNullable<SniffedKind> }
  | { ok: false; reason: string };

/**
 * Step 4 of the pipeline: the header must agree with BOTH the extension and
 * the declared type.
 *
 * Returns a reason rather than throwing, so the caller decides the status code
 * and the wording. Reasons are written for the person uploading — they say
 * what is wrong with the file, not which check rejected it.
 */
export function checkContent(
  buf: Buffer,
  declaredMime: string,
  extension: string
): ContentCheck {
  const kind = sniff(buf);

  if (!kind) {
    return {
      ok: false,
      reason:
        'That file could not be recognised as a PDF, a CAD drawing or an IFC model. It may be corrupt, ' +
        'or saved in a format this system does not accept.',
    };
  }

  const byExtension = EXTENSION_TO_KINDS[extension.toLowerCase()];
  if (!byExtension) {
    return { ok: false, reason: `Files ending in .${extension} are not accepted here.` };
  }

  if (!byExtension.includes(kind)) {
    return {
      ok: false,
      reason:
        `That file is named .${extension} but its contents are ${describe(kind)}. ` +
        'Re-save it in the right format, or rename it to match what it actually is.',
    };
  }

  const byDeclared = DECLARED_TO_KINDS[declaredMime.toLowerCase()];
  // An unrecognised declared type is not fatal on its own — the extension and
  // the bytes already agree, and browsers send all sorts of things for CAD.
  if (byDeclared && !byDeclared.includes(kind)) {
    return {
      ok: false,
      reason:
        `That file was sent as ${declaredMime} but its contents are ${describe(kind)}. ` +
        'Upload the original file rather than a renamed copy.',
    };
  }

  return { ok: true, kind };
}

const DESCRIPTIONS: Record<NonNullable<SniffedKind>, string> = {
  pdf: 'a PDF',
  dwg: 'a DWG drawing',
  dxf: 'a DXF drawing',
  ifc: 'an IFC model',
  png: 'a PNG image',
  jpeg: 'a JPEG image',
  zip: 'a ZIP archive',
};

const describe = (kind: NonNullable<SniffedKind>): string => DESCRIPTIONS[kind];

/** The canonical MIME type to STORE, derived from the bytes rather than trusted. */
export const canonicalMime = (kind: NonNullable<SniffedKind>): string =>
  ({
    pdf: 'application/pdf',
    dwg: 'image/vnd.dwg',
    dxf: 'image/vnd.dxf',
    ifc: 'application/x-step',
    png: 'image/png',
    jpeg: 'image/jpeg',
    zip: 'application/zip',
  })[kind];
