import 'server-only';
import { jsPDF } from 'jspdf';
import { prisma } from '@/server/db/prisma';
import { env } from '@/server/config/env';
import {
  DEMO_GUIDES,
  DOWNLOAD_CATEGORIES,
  DOWNLOAD_KIND_LABEL,
  PLACEHOLDER_NOTE,
  downloadBySlug,
  type DownloadItem,
} from '@/lib/public-content';
import { listPublicDevelopers, listPublicLtps, type Paged } from './registers';

/**
 * THE PUBLIC DOWNLOADS.
 *
 * Three kinds of file, and each says which it is on its face:
 *
 *   LIVE         a CSV built at request time from the database — the document
 *                checklist, the developer register, the LTP register. These
 *                are BBAS's own data, not an imitation of anything.
 *   DEMO_GUIDE   a short PDF written for this demonstration from the content
 *                in `public-content.ts`.
 *   PLACEHOLDER  a one-page PDF that stands where an official document would
 *                go and says, in the file itself, that it is not one.
 *
 * No official order, regulation or manual was supplied to this project, so no
 * file pretends to be one. Every PDF carries the demonstration mark on every
 * page — the same rule the demo payment receipt and the demo permission order
 * follow — so a file that leaves the portal cannot be mistaken for the real
 * thing.
 */

export type BuiltDownload = { filename: string; contentType: string; body: Buffer };

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * A cell that cannot be read as a formula. Names in these registers were typed
 * by members of the public, and a spreadsheet will execute a cell that starts
 * with `=`, `+`, `-` or `@`.
 */
const csvCell = (value: unknown): string => {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csv = (header: string[], rows: unknown[][]) => Buffer.from(`﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8');

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/** Reads every page of a paged register, capped so a runaway table cannot build an unbounded file. */
async function all<T>(fetchPage: (page: number) => Promise<Paged<T>>, cap = 5000): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < cap; page += 1) {
    const result = await fetchPage(page);
    out.push(...result.rows);
    if (page >= result.totalPages) break;
  }
  return out.slice(0, cap);
}

async function documentChecklist(): Promise<Buffer> {
  const rows = await prisma.documentRequirement.findMany({
    where: { isActive: true, documentType: { isActive: true, deletedAt: null } },
    orderBy: [{ displayOrder: 'asc' }],
    select: {
      isMandatory: true,
      buildingUse: true,
      landUseZone: true,
      helpText: true,
      applicationType: { select: { name: true } },
      documentType: { select: { name: true, category: true, allowedExtensions: true, maxSizeMb: true } },
    },
  });
  return csv(
    ['Permission type', 'Document', 'Category', 'Required', 'Building use', 'Land use', 'Accepted formats', 'Maximum size (MB)', 'Note'],
    rows.map((r) => [
      r.applicationType?.name ?? 'All permission types',
      r.documentType.name,
      r.documentType.category,
      r.isMandatory ? 'Required' : 'If applicable',
      r.buildingUse || 'Any',
      r.landUseZone || 'Any',
      Array.isArray(r.documentType.allowedExtensions) ? (r.documentType.allowedExtensions as string[]).join(' / ').toUpperCase() : '',
      r.documentType.maxSizeMb,
      r.helpText,
    ])
  );
}

const registerHeader = ['Registration number', 'Name', 'Type', 'Status', 'Valid from', 'Valid to'];

async function developerRegister(): Promise<Buffer> {
  const rows = await all((page) => listPublicDevelopers({ page, pageSize: 50 }));
  return csv(registerHeader, rows.map((r) => [r.registrationNumber, r.organization ? `${r.name} (${r.organization})` : r.name, r.typeLabel, r.statusLabel, day(r.validFrom), day(r.validTo)]));
}

async function ltpRegister(): Promise<Buffer> {
  const rows = await all((page) => listPublicLtps({ page, pageSize: 50 }));
  return csv(registerHeader, rows.map((r) => [r.registrationNumber, r.name, r.typeLabel, r.statusLabel, day(r.validFrom), day(r.validTo)]));
}

// ── PDF ─────────────────────────────────────────────────────────────────────

const PAGE = { w: 595.28, h: 841.89 };
const MARGIN = 56;
const INK = '#18181b';
const MUTED = '#52525b';
const WARN = '#b45309';

function pdfFor(item: DownloadItem): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const width = PAGE.w - MARGIN * 2;
  let y = MARGIN;

  const footer = () => {
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(WARN);
    doc.text('DEMONSTRATION DOCUMENT — NOT AN OFFICIAL DOCUMENT', MARGIN, PAGE.h - 34);
    doc.setFont('helvetica', 'normal').setTextColor(MUTED);
    doc.text(`${env.appName} public portal · ${DOWNLOAD_KIND_LABEL[item.kind]}`, MARGIN, PAGE.h - 22);
  };
  const ensure = (needed: number) => {
    if (y + needed > PAGE.h - 60) {
      footer();
      doc.addPage();
      y = MARGIN;
    }
  };
  const write = (text: string, opts: { size?: number; bold?: boolean; color?: string; gap?: number; indent?: number } = {}) => {
    const size = opts.size ?? 11;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal').setFontSize(size).setTextColor(opts.color ?? INK);
    const lines = doc.splitTextToSize(text, width - (opts.indent ?? 0)) as string[];
    for (const line of lines) {
      ensure(size * 1.5);
      doc.text(line, MARGIN + (opts.indent ?? 0), y);
      y += size * 1.45;
    }
    y += opts.gap ?? 4;
  };

  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(WARN);
  doc.text('DEMONSTRATION DOCUMENT — NOT AN OFFICIAL DOCUMENT', MARGIN, y);
  y += 26;

  const guide = DEMO_GUIDES[item.slug];
  if (guide) {
    write(guide.title, { size: 20, bold: true, gap: 8 });
    write(guide.intro, { color: MUTED, gap: 14 });
    for (const section of guide.sections) {
      write(section.heading, { size: 13, bold: true, gap: 4 });
      for (const p of section.paragraphs ?? []) write(p, { gap: 6 });
      for (const b of section.bullets ?? []) write(`•  ${b}`, { indent: 10, gap: 3 });
      y += 8;
    }
  } else {
    write(item.title, { size: 20, bold: true, gap: 8 });
    write(item.summary, { color: MUTED, gap: 14 });
    write('Placeholder', { size: 13, bold: true, gap: 4 });
    write(PLACEHOLDER_NOTE, { gap: 10 });
    write('When an official document of this kind is supplied to the project, it replaces this file at the same address.', { color: MUTED });
  }

  footer();
  return Buffer.from(doc.output('arraybuffer'));
}

// ── Entry point ─────────────────────────────────────────────────────────────

const slugFile = (slug: string) => slug.replace(/[^a-z0-9-]/g, '');

/** Builds one download by slug, or null for a slug that is not in the catalogue. */
export async function buildDownload(slug: string): Promise<BuiltDownload | null> {
  const item = downloadBySlug(slug);
  if (!item) return null;

  if (item.kind === 'LIVE') {
    const body = item.slug === 'document-checklist' ? await documentChecklist() : item.slug === 'registered-developers' ? await developerRegister() : await ltpRegister();
    return { filename: `bbas-${slugFile(item.slug)}.csv`, contentType: 'text/csv; charset=utf-8', body };
  }
  return { filename: `bbas-${slugFile(item.slug)}-DEMO.pdf`, contentType: 'application/pdf', body: pdfFor(item) };
}

export { DOWNLOAD_CATEGORIES };
