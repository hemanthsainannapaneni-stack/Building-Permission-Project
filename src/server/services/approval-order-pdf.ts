import 'server-only';
import { randomBytes } from 'node:crypto';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { prisma } from '@/server/db/prisma';
import { storage, buildStorageKey } from '@/server/storage';
import { env } from '@/server/config/env';
import { notFound } from '@/server/http/errors';
import { ORDER_STATUS, isProvisional, orderStatusLabel } from '@/lib/approval-orders';

/**
 * THE BUILDING PERMISSION ORDER, as a PDF.
 *
 * ── It renders from the SNAPSHOT, and joins nothing ─────────────────────
 *
 * `approval_orders.snapshot` froze the applicant, the property, every building
 * figure and the conditions at the moment the order was drafted. This renderer
 * reads that JSON and reads no live table. A fee schedule revised next year, an
 * applicant's name corrected next week, a zone renamed — none of them may alter
 * a permission already granted, and the way to guarantee that is to have
 * nothing to re-read. The same rule the receipt follows, for the same reason.
 *
 * ── A provisional order says so, in a way you cannot miss ───────────────
 *
 * Everything short of ISSUED carries a PROVISIONAL watermark naming its
 * actual state, because a draft that prints identically to the released
 * permission is exactly the artefact that ends up on a site hoarding. DEMO_MODE
 * stamps its own, independently: a demonstration order is never allowed to
 * print as though it were a real sanction.
 *
 * The two are separate judgements and both can be true at once — a demo draft
 * carries both marks.
 */

const PAGE = { width: 595.28, height: 841.89 };
const M = { left: 48, right: 48, top: 46, bottom: 60 };
const CONTENT_WIDTH = PAGE.width - M.left - M.right;
const TABLE_WIDTH = Math.floor(CONTENT_WIDTH);

const INK = '#18181b';
const MUTED = '#52525b';
const LINE = '#d4d4d8';
const ACCENT = '#15803d';
const DANGER = '#b91c1c';

// ═══════════════════════════════════════════════════════════════════════════
// The snapshot, as the renderer reads it
// ═══════════════════════════════════════════════════════════════════════════

type Snapshot = {
  orderNumber?: string;
  issuedAt?: string;
  validUntil?: string;
  application?: {
    applicationNumber?: string;
    type?: string;
    approvedAt?: string;
    zone?: string;
  };
  applicant?: { name?: string; address?: string; phone?: string; email?: string };
  property?: Record<string, unknown>;
  building?: Record<string, unknown>;
  derived?: {
    fsi?: number | null;
    coveragePercent?: number | null;
    netPlotAreaSqm?: number | null;
    deductedAreaSqm?: number | null;
    netPlotAssumed?: boolean;
  };
  clearances?: Array<{ code?: string; name?: string; verifiedAt?: string | null; expiresOn?: string | null }>;
  conditions?: string[];
  fees?: Array<{ demandNumber?: string; totalAmount?: string; paidAmount?: string; paidAt?: string | null }>;
};

export type OrderModel = {
  id: string;
  orderNumber: string;
  status: string;
  verificationCode: string;
  applicationId: string;
  issuedByName: string;
  snapshot: Snapshot;
  isDemo: boolean;
  isProvisional: boolean;
};

async function loadOrder(orderId: string): Promise<OrderModel> {
  const row = await prisma.approvalOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      verificationCode: true,
      applicationId: true,
      issuedById: true,
      snapshot: true,
      conditions: true,
    },
  });

  if (!row) throw notFound('That approval order could not be found.');

  const issuer = await prisma.user.findUnique({
    where: { id: row.issuedById },
    select: { name: true, designation: true },
  });

  const snapshot = (row.snapshot ?? {}) as Snapshot;

  // Conditions live on their own column as well as in the snapshot, because an
  // administrator may revise the standard set between drafting and issue. The
  // column wins: it is what the signing authority last saw.
  const stored = Array.isArray(row.conditions) ? (row.conditions as string[]) : null;
  if (stored?.length) snapshot.conditions = stored;

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    verificationCode: row.verificationCode,
    applicationId: row.applicationId,
    issuedByName: issuer?.name ?? 'Authorised officer',
    snapshot,
    isDemo: env.demoMode,
    isProvisional: isProvisional(row.status),
  };
}

export function orderFilename(orderNumber: string): string {
  return `building-permission-${orderNumber.replace(/[/\\]/g, '-')}.pdf`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════

/** Renders the order and returns the PDF bytes. */
export async function renderApprovalOrder(
  orderId: string
): Promise<{ bytes: Buffer; filename: string; model: OrderModel }> {
  const model = await loadOrder(orderId);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  let y = header(doc, model);
  y = reference(doc, model, y);
  y = owner(doc, model, y);
  y = sanction(doc, model, y);
  y = particulars(doc, model, y);
  y = clearances(doc, model, y);
  y = fees(doc, model, y);
  y = conditions(doc, model, y);
  authority(doc, model, y);

  decorate(doc, model);

  return {
    bytes: Buffer.from(doc.output('arraybuffer') as ArrayBuffer),
    filename: orderFilename(model.orderNumber),
    model,
  };
}

function header(doc: jsPDF, model: OrderModel): number {
  doc.setFillColor(ACCENT);
  doc.rect(0, 0, PAGE.width, 6, 'F');

  doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(INK);
  doc.text(env.appName.toUpperCase(), M.left, M.top + 14);

  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(MUTED);
  doc.text('Building Permission Approval System', M.left, M.top + 29);
  doc.text(
    `${model.snapshot.application?.zone || 'Head Office'} · ${model.snapshot.application?.type ?? ''}`,
    M.left,
    M.top + 42
  );

  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(ACCENT);
  doc.text('BUILDING PERMISSION ORDER', PAGE.width - M.right, M.top + 14, { align: 'right' });

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(MUTED);
  doc.text(model.orderNumber, PAGE.width - M.right, M.top + 28, { align: 'right' });

  // The state is on the face of the document, not only in the watermark. A
  // reader scanning the top-right corner should not have to notice a diagonal.
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(8.5)
    .setTextColor(model.isProvisional ? DANGER : ACCENT);
  doc.text(orderStatusLabel(model.status).toUpperCase(), PAGE.width - M.right, M.top + 41, {
    align: 'right',
  });

  return rule(doc, M.top + 52);
}

function reference(doc: jsPDF, model: OrderModel, y: number): number {
  const s = model.snapshot;
  const rows: Array<[string, string]> = [
    ['Proceeding No.', model.orderNumber],
    ['Application No.', s.application?.applicationNumber ?? '—'],
    ['Date of sanction', s.application?.approvedAt ? fmtDate(s.application.approvedAt) : '—'],
    ['Valid until', s.validUntil ? fmtDate(s.validUntil) : '—'],
  ];

  const colWidth = CONTENT_WIDTH / 2;
  const top = y + 16;

  rows.forEach(([label, value], i) => {
    const x = M.left + (i % 2) * colWidth;
    const line = top + Math.floor(i / 2) * 26;

    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
    doc.text(label.toUpperCase(), x, line);
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
    doc.text(value, x, line + 12);
  });

  return top + Math.ceil(rows.length / 2) * 26;
}

function owner(doc: jsPDF, model: OrderModel, y: number): number {
  let top = rule(doc, y + 2) + 16;
  const s = model.snapshot;

  const facts: Array<[string, string]> = [
    ['Owner', s.applicant?.name || 'Not recorded'],
    ['Site', siteAddress(s.property)],
    [
      'Survey / plot',
      [str(s.property?.surveyNumbers), str(s.property?.plotNo)].filter(Boolean).join(' · ') ||
        'Not recorded',
    ],
  ];

  for (const [label, value] of facts) {
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
    doc.text(label.toUpperCase(), M.left, top);

    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(INK);
    const lines = doc.splitTextToSize(value, CONTENT_WIDTH) as string[];
    doc.text(lines, M.left, top + 12);
    top += 12 + lines.length * 12 + 6;
  }

  return top;
}

/** The operative sentence — the one that actually grants the permission. */
function sanction(doc: jsPDF, model: OrderModel, y: number): number {
  const top = rule(doc, y) + 18;
  const s = model.snapshot;

  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(INK);

  const text =
    `Permission is hereby granted under the building rules in force for the construction described ` +
    `below, on the site described above, in accordance with the plans and particulars approved with ` +
    `application ${s.application?.applicationNumber ?? ''}, and subject to the conditions set out in ` +
    `this order.`;

  const lines = doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
  doc.text(lines, M.left, top);
  return top + lines.length * 13 + 8;
}

/** Every sanctioned figure, in one table. */
function particulars(doc: jsPDF, model: OrderModel, y: number): number {
  const b = model.snapshot.building ?? {};
  const d = model.snapshot.derived ?? {};

  const rows: Array<[string, string]> = [
    ['Plot area', sqm(b.plotAreaSqm)],
    [
      'Net plot area',
      d.netPlotAreaSqm != null
        ? `${num(d.netPlotAreaSqm)} sq m${d.netPlotAssumed ? ' (no deduction recorded)' : ''}`
        : '—',
    ],
    ['Built-up area', sqm(b.builtUpAreaSqm)],
    ['Floor area', sqm(b.floorAreaSqm)],
    ['FSI achieved', d.fsi != null ? num(d.fsi) : 'Not assessed'],
    ['Coverage', d.coveragePercent != null ? `${num(d.coveragePercent)} %` : 'Not assessed'],
    ['Coverage area', sqm(b.coverageAreaSqm)],
    ['Height', b.buildingHeightM ? `${num(b.buildingHeightM)} m` : '—'],
    [
      'Floors',
      b.numFloors != null
        ? `${b.numFloors}${Number(b.numBasements ?? 0) > 0 ? ` + ${b.numBasements} basement(s)` : ''}`
        : '—',
    ],
    ['Dwelling units', b.numDwellingUnits != null ? String(b.numDwellingUnits) : '—'],
    ['Parking area', sqm(b.parkingAreaSqm)],
    [
      'Setbacks (F/R/L/R)',
      [b.setbackFrontM, b.setbackRearM, b.setbackLeftM, b.setbackRightM]
        .map((v) => (v == null ? '—' : num(v)))
        .join(' / ') + ' m',
    ],
    ['Use', [str(b.buildingUse), str(b.occupancyType)].filter(Boolean).join(' · ') || '—'],
    ['Structure', str(b.structureType) || '—'],
  ];

  const top = y + 12;
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text('Sanctioned particulars', M.left, top);

  // Two label/value pairs per row, so fourteen figures fit on one page
  // alongside the conditions rather than pushing them to a second sheet.
  const body: string[][] = [];
  for (let i = 0; i < rows.length; i += 2) {
    const left = rows[i]!;
    const right = rows[i + 1];
    body.push([left[0], left[1], right?.[0] ?? '', right?.[1] ?? '']);
  }

  autoTable(doc, {
    startY: top + 6,
    margin: { left: M.left, right: M.right },
    body,
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 4,
      lineColor: LINE,
      lineWidth: 0.5,
      textColor: INK,
    },
    columnStyles: {
      0: { cellWidth: 110, textColor: MUTED },
      1: { cellWidth: 140, fontStyle: 'bold' },
      2: { cellWidth: 110, textColor: MUTED },
      3: { cellWidth: 139, fontStyle: 'bold' },
    },
    tableWidth: TABLE_WIDTH,
    theme: 'grid',
  });

  return tableBottom(doc, top);
}

function clearances(doc: jsPDF, model: OrderModel, y: number): number {
  const list = model.snapshot.clearances ?? [];
  let top = pageBreakIfNeeded(doc, y + 18, 90);

  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text('Clearances and NOCs on record', M.left, top);
  top += 6;

  if (!list.length) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(MUTED);
    // Stated positively. A blank section reads as an omission; this reads as
    // the fact it is — no clearance was required, or none was produced.
    doc.text(
      'No separate clearance or no-objection certificate is recorded against this application.',
      M.left,
      top + 12
    );
    return top + 20;
  }

  autoTable(doc, {
    startY: top + 4,
    margin: { left: M.left, right: M.right },
    head: [['Clearance', 'Verified on', 'Valid until']],
    body: list.map((c) => [
      c.name ?? c.code ?? '—',
      c.verifiedAt ? fmtDate(c.verifiedAt) : '—',
      c.expiresOn ? fmtDate(c.expiresOn) : 'Not stated',
    ]),
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 4,
      lineColor: LINE,
      lineWidth: 0.5,
      textColor: INK,
    },
    headStyles: {
      fillColor: '#f4f4f5',
      textColor: INK,
      fontStyle: 'bold',
      fontSize: 8,
      lineColor: LINE,
      lineWidth: 0.5,
    },
    columnStyles: { 0: { cellWidth: 259 }, 1: { cellWidth: 120 }, 2: { cellWidth: 120 } },
    tableWidth: TABLE_WIDTH,
    theme: 'grid',
  });

  return tableBottom(doc, top);
}

function fees(doc: jsPDF, model: OrderModel, y: number): number {
  const list = model.snapshot.fees ?? [];
  if (!list.length) return y;

  const top = pageBreakIfNeeded(doc, y + 18, 90);

  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text('Fees paid', M.left, top);

  autoTable(doc, {
    startY: top + 10,
    margin: { left: M.left, right: M.right },
    head: [['Demand No.', 'Amount (INR)', 'Paid (INR)', 'Paid on']],
    body: list.map((f) => [
      f.demandNumber ?? '—',
      money(f.totalAmount),
      money(f.paidAmount),
      f.paidAt ? fmtDate(f.paidAt) : '—',
    ]),
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 4,
      lineColor: LINE,
      lineWidth: 0.5,
      textColor: INK,
    },
    headStyles: {
      fillColor: '#f4f4f5',
      textColor: INK,
      fontStyle: 'bold',
      fontSize: 8,
      lineColor: LINE,
      lineWidth: 0.5,
    },
    columnStyles: {
      0: { cellWidth: 179 },
      1: { cellWidth: 120, halign: 'right' },
      2: { cellWidth: 100, halign: 'right' },
      3: { cellWidth: 100 },
    },
    tableWidth: TABLE_WIDTH,
    theme: 'grid',
  });

  return tableBottom(doc, top);
}

function conditions(doc: jsPDF, model: OrderModel, y: number): number {
  const list = model.snapshot.conditions ?? [];
  if (!list.length) return y;

  let top = pageBreakIfNeeded(doc, y + 20, 160);

  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text('Conditions', M.left, top);
  top += 14;

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(INK);

  list.forEach((condition, i) => {
    const lines = doc.splitTextToSize(`${i + 1}.  ${condition}`, CONTENT_WIDTH - 8) as string[];
    top = pageBreakIfNeeded(doc, top, lines.length * 11 + 8);
    doc.text(lines, M.left + 4, top);
    top += lines.length * 11 + 5;
  });

  return top;
}

function authority(doc: jsPDF, model: OrderModel, y: number): number {
  let top = pageBreakIfNeeded(doc, y + 26, 150);

  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(INK);
  doc.text('For and on behalf of', PAGE.width - M.right, top, { align: 'right' });
  top += 38;

  doc.setDrawColor(LINE).setLineWidth(0.5);
  doc.line(PAGE.width - M.right - 170, top, PAGE.width - M.right, top);
  top += 13;

  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text(model.issuedByName, PAGE.width - M.right, top, { align: 'right' });
  top += 12;

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(MUTED);
  doc.text('Sanctioning authority', PAGE.width - M.right, top, { align: 'right' });
  top += 11;
  doc.text(env.appName, PAGE.width - M.right, top, { align: 'right' });

  // ── Verification, and an honest word about the signature ──────────────
  top += 24;
  doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(INK);
  doc.text('Verify this order', M.left, top);

  top += 11;
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  const verify = doc.splitTextToSize(
    `${env.appUrl}/verify-order/${model.verificationCode}\n` +
      'This order is system-generated and is NOT digitally signed. Its authenticity is established ' +
      'by the verification link above and by the departmental record, not by this printout.',
    CONTENT_WIDTH - 180
  ) as string[];
  doc.text(verify, M.left, top);

  return top + verify.length * 10;
}

function decorate(doc: jsPDF, model: OrderModel) {
  const pages = doc.getNumberOfPages();

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);

    // Two independent marks. A demo draft legitimately carries both: one says
    // this is not a real sanction, the other says it is not a finished one.
    if (model.isProvisional) {
      doc.saveGraphicsState();
      doc.setFont('helvetica', 'bold').setFontSize(46).setTextColor('#fbdcdc');
      doc.text(orderStatusLabel(model.status).toUpperCase(), PAGE.width / 2, PAGE.height / 2 - 40, {
        align: 'center',
        angle: 32,
      });
      doc.setFontSize(12);
      doc.text('NOT AN ISSUED PERMISSION', PAGE.width / 2, PAGE.height / 2 + 4, {
        align: 'center',
        angle: 32,
      });
      doc.restoreGraphicsState();
    }

    if (model.isDemo) {
      doc.saveGraphicsState();
      doc.setFont('helvetica', 'bold').setFontSize(34).setTextColor('#e2e8f0');
      doc.text('DEMONSTRATION', PAGE.width / 2, PAGE.height / 2 + 90, {
        align: 'center',
        angle: 32,
      });
      doc.restoreGraphicsState();
    }

    doc.setDrawColor(LINE).setLineWidth(0.5);
    doc.line(M.left, PAGE.height - M.bottom + 12, PAGE.width - M.right, PAGE.height - M.bottom + 12);

    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
    doc.text(
      `${model.orderNumber} · ${model.snapshot.application?.applicationNumber ?? ''} · ${orderStatusLabel(model.status)}`,
      M.left,
      PAGE.height - M.bottom + 26
    );
    doc.text(`Page ${page} of ${pages}`, PAGE.width - M.right, PAGE.height - M.bottom + 26, {
      align: 'right',
    });

    doc.text(
      model.isDemo
        ? `Generated ${fmtDateTime(new Date())} by ${env.appName}. DEMONSTRATION DOCUMENT — it grants no permission and carries no statutory weight.`
        : `Generated ${fmtDateTime(new Date())} by ${env.appName}.`,
      M.left,
      PAGE.height - M.bottom + 37
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Renders the order and stores the bytes, replacing whatever was there.
 *
 * Re-rendering is legitimate at every state before ISSUED: a preview exists to
 * be looked at and corrected, and the stored object must match the state the
 * row is in. The old object is removed after the row points at the new one, so
 * a crash between the two leaves an orphan rather than a broken link.
 */
export async function storeApprovalOrderPdf(orderId: string) {
  const existing = await prisma.approvalOrder.findUnique({
    where: { id: orderId },
    select: { storageKey: true, applicationId: true },
  });

  if (!existing) throw notFound('That approval order could not be found.');

  const { bytes, model } = await renderApprovalOrder(orderId);

  const storageKey = buildStorageKey({
    applicationId: existing.applicationId,
    kind: 'reports',
    random: randomBytes(20).toString('hex'),
    extension: 'pdf',
  });

  await storage.put({
    key: storageKey,
    body: bytes,
    contentType: 'application/pdf',
    filename: orderFilename(model.orderNumber),
  });

  await prisma.approvalOrder.update({ where: { id: orderId }, data: { storageKey } });

  if (existing.storageKey && existing.storageKey !== storageKey) {
    await storage.remove(existing.storageKey).catch(() => {});
  }

  return { storageKey, model };
}

/** Returns the stored PDF, rendering it on first request. */
export async function ensureApprovalOrderPdf(orderId: string): Promise<Buffer> {
  const row = await prisma.approvalOrder.findUnique({
    where: { id: orderId },
    select: { storageKey: true },
  });

  if (!row) throw notFound('That approval order could not be found.');

  // Regenerate when the row exists but the bytes are gone — a storage wipe in
  // development must not leave a permanently broken download link.
  if (row.storageKey && (await storage.exists(row.storageKey))) {
    return storage.get(row.storageKey);
  }

  await storeApprovalOrderPdf(orderId);
  const refreshed = await prisma.approvalOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { storageKey: true },
  });

  return storage.get(refreshed.storageKey);
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════

function siteAddress(property: Record<string, unknown> | undefined): string {
  if (!property) return 'Not recorded';

  const line = [
    [str(property.doorNo), str(property.plotNo) && `Plot ${str(property.plotNo)}`]
      .filter(Boolean)
      .join(', '),
    str(property.streetName),
    str(property.localityName),
    str(property.layoutName),
    str(property.village),
    str(property.mandal),
    [str(property.district), str(property.pincode)].filter(Boolean).join(' — '),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');

  return line || 'Not recorded';
}

const str = (v: unknown): string => (v == null ? '' : String(v));

const num = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
};

/** An unmeasured area prints as a dash, never as zero. */
const sqm = (v: unknown): string => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${num(n)} sq m`;
};

const money = (v: unknown): string =>
  Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: Date | string): string =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

const fmtDateTime = (d: Date | string): string =>
  new Date(d).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function rule(doc: jsPDF, y: number): number {
  doc.setDrawColor(LINE).setLineWidth(0.5);
  doc.line(M.left, y, PAGE.width - M.right, y);
  return y;
}

function tableBottom(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return last?.finalY ?? fallback;
}

function pageBreakIfNeeded(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PAGE.height - M.bottom) return y;
  doc.addPage();
  return M.top;
}

export { ORDER_STATUS };
