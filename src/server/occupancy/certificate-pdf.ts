import 'server-only';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { env } from '@/server/config/env';
import type { ComparisonRow } from '@/lib/occupancy';

/**
 * THE OCCUPANCY CERTIFICATE, as a PDF.
 *
 * Renders from `occupancy_applications.certificateSnapshot` alone — frozen at
 * issue, joined to nothing — for the reason the building permission order
 * does: a record corrected next month must not alter a certificate already
 * issued. Rendered on request rather than stored: the snapshot is the record,
 * the PDF is a view of it, and there is nothing to keep in step.
 *
 * DEMO_MODE stamps it on the face, in the watermark and in the footer. A
 * demonstration certificate must never pass for a real one.
 */

const PAGE = { width: 595.28, height: 841.89 };
const M = { left: 48, right: 48, top: 46, bottom: 60 };
const W = PAGE.width - M.left - M.right;
const INK = '#18181b';
const MUTED = '#52525b';
const LINE = '#d4d4d8';
const ACCENT = '#1d4ed8';
const DANGER = '#b91c1c';

export type CertificateSnapshot = {
  certificateNumber: string;
  issuedAt: string;
  issuedBy: { name: string; roleKey: string };
  verificationCode: string;
  occupancyNumber: string;
  applicationNumber: string;
  zone: string;
  orderNumber: string;
  orderIssuedAt: string;
  owner: string;
  ltp: { name: string; licenceNo: string };
  site: string;
  use: string;
  commencementDate: string | null;
  completionDate: string;
  inspection: { inspectedAt: string | null; inspector: string; asBuiltSource: string } | null;
  comparison: ComparisonRow[];
  approvedAreaSqm: number | null;
  completedAreaSqm: number | null;
  conditions: string[];
  outwardNumber: string;
};

const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fig = (v: number | null | undefined, unit = '') => (v == null ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`);

export function certificateFilename(certificateNumber: string) {
  return `occupancy-certificate-${certificateNumber.replace(/[/\\]/g, '-')}.pdf`;
}

export function renderOccupancyCertificate(s: CertificateSnapshot): Buffer {
  const demo = env.demoMode;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  // ── Header ─────────────────────────────────────────────────────────────
  doc.setFillColor(ACCENT);
  doc.rect(0, 0, PAGE.width, 6, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(INK);
  doc.text(env.appName.toUpperCase(), M.left, M.top + 14);
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(MUTED);
  doc.text('Building Permission Approval System', M.left, M.top + 29);
  doc.text(s.zone || 'Head Office', M.left, M.top + 42);
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(ACCENT);
  doc.text('OCCUPANCY CERTIFICATE', PAGE.width - M.right, M.top + 14, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(MUTED);
  doc.text(s.certificateNumber, PAGE.width - M.right, M.top + 28, { align: 'right' });
  doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(demo ? DANGER : ACCENT);
  doc.text(demo ? 'DEMONSTRATION — NOT VALID' : 'ISSUED', PAGE.width - M.right, M.top + 41, { align: 'right' });
  let y = rule(doc, M.top + 52);

  // ── Reference block ────────────────────────────────────────────────────
  const refs: Array<[string, string]> = [
    ['Certificate No.', s.certificateNumber],
    ['Date of issue', fmtDate(s.issuedAt)],
    ['Application No.', s.applicationNumber],
    ['BPO / Proceeding No.', `${s.orderNumber} (${fmtDate(s.orderIssuedAt)})`],
    ['Occupancy application', s.occupancyNumber],
    ['Outward No.', s.outwardNumber || '—'],
  ];
  refs.forEach(([label, value], i) => {
    const x = M.left + (i % 2) * (W / 2);
    const line = y + 16 + Math.floor(i / 2) * 26;
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
    doc.text(label.toUpperCase(), x, line);
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
    doc.text(value, x, line + 12);
  });
  y = rule(doc, y + 16 + 3 * 26) + 16;

  // ── Parties and site ───────────────────────────────────────────────────
  for (const [label, value] of [
    ['Owner', s.owner || 'Not recorded'],
    ['Licensed technical person', `${s.ltp.name}${s.ltp.licenceNo ? ` · ${s.ltp.licenceNo}` : ''}`],
    ['Site', s.site || 'Not recorded'],
    ['Use', s.use || 'As sanctioned'],
  ] as Array<[string, string]>) {
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
    doc.text(label.toUpperCase(), M.left, y);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(INK);
    const lines = doc.splitTextToSize(value, W) as string[];
    doc.text(lines, M.left, y + 12);
    y += 12 + lines.length * 12 + 6;
  }

  // ── The operative sentence ─────────────────────────────────────────────
  y = rule(doc, y) + 18;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(INK);
  const operative =
    `Certified that the building described above, constructed under building permission order ${s.orderNumber}, ` +
    `was completed on ${fmtDate(s.completionDate)} and was inspected on ${fmtDate(s.inspection?.inspectedAt)}` +
    `${s.inspection?.inspector ? ` by ${s.inspection.inspector}` : ''}. It is found fit for occupation for the use ` +
    `sanctioned, subject to the conditions below.`;
  const opLines = doc.splitTextToSize(operative, W) as string[];
  doc.text(opLines, M.left, y);
  y += opLines.length * 13 + 10;

  // ── Areas ──────────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    margin: { left: M.left, right: M.right },
    head: [['Approved built-up area', 'Completed built-up area', 'Commenced', 'Completed']],
    body: [[fig(s.approvedAreaSqm, 'sq m'), fig(s.completedAreaSqm, 'sq m'), fmtDate(s.commencementDate), fmtDate(s.completionDate)]],
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, lineColor: LINE, lineWidth: 0.5, textColor: INK },
    headStyles: { fillColor: '#eff6ff', textColor: INK, fontStyle: 'bold', fontSize: 8 },
  });
  y = bottom(doc, y) + 14;

  // ── Approved vs as built ───────────────────────────────────────────────
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text('Approved and as built', M.left, y);
  autoTable(doc, {
    startY: y + 6,
    margin: { left: M.left, right: M.right },
    head: [['Parameter', 'Approved', 'As built', 'Finding']],
    body: s.comparison.map((r) => [
      r.label,
      fig(r.approved, r.unit),
      fig(r.asBuilt, r.unit),
      r.verdict === 'WITHIN' ? 'Within tolerance' : r.verdict === 'DEVIATION' ? `Deviation (${r.differencePercent ?? '—'} %)` : 'Not recorded',
    ]),
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, lineColor: LINE, lineWidth: 0.5, textColor: INK },
    headStyles: { fillColor: '#f4f4f5', textColor: INK, fontStyle: 'bold', fontSize: 8 },
  });
  y = bottom(doc, y) + 6;
  if (s.inspection?.asBuiltSource === 'DEMO') {
    doc.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(DANGER);
    doc.text('As-built figures are DEMO data generated for demonstration — not site measurements.', M.left, y + 6);
    y += 12;
  }

  // ── Conditions ─────────────────────────────────────────────────────────
  y += 12;
  if (y > PAGE.height - 220) {
    doc.addPage();
    y = M.top + 10;
  }
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text('Conditions', M.left, y);
  y += 14;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(INK);
  s.conditions.forEach((c, i) => {
    const lines = doc.splitTextToSize(`${i + 1}. ${c}`, W - 10) as string[];
    doc.text(lines, M.left + 4, y);
    y += lines.length * 11.5 + 4;
  });
  if (demo) {
    doc.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(MUTED);
    doc.text('Condition wording is placeholder text for demonstration, drawn from no published rule.', M.left, y + 2);
    y += 10;
  }

  // ── Authority ──────────────────────────────────────────────────────────
  y = Math.max(y + 24, PAGE.height - M.bottom - 90);
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  doc.text(`Verification code: ${s.verificationCode}`, M.left, y + 30);
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text(s.issuedBy.name, PAGE.width - M.right, y + 18, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(MUTED);
  doc.text(`${s.issuedBy.roleKey} · ${demo ? 'no signature — demonstration' : 'Authorised signatory'}`, PAGE.width - M.right, y + 30, { align: 'right' });

  // ── Every page ─────────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    if (demo) {
      doc.saveGraphicsState();
      doc.setFont('helvetica', 'bold').setFontSize(40).setTextColor('#e2e8f0');
      doc.text('DEMONSTRATION', PAGE.width / 2, PAGE.height / 2 + 40, { align: 'center', angle: 32 });
      doc.setFontSize(12);
      doc.text('NOT A VALID OCCUPANCY CERTIFICATE', PAGE.width / 2, PAGE.height / 2 + 80, { align: 'center', angle: 32 });
      doc.restoreGraphicsState();
    }
    doc.setDrawColor(LINE).setLineWidth(0.5);
    doc.line(M.left, PAGE.height - M.bottom + 12, PAGE.width - M.right, PAGE.height - M.bottom + 12);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
    doc.text(`${s.certificateNumber} · ${s.applicationNumber} · ${s.orderNumber}`, M.left, PAGE.height - M.bottom + 26);
    doc.text(`Page ${page} of ${pages}`, PAGE.width - M.right, PAGE.height - M.bottom + 26, { align: 'right' });
    doc.text(
      demo
        ? `Generated by ${env.appName}. DEMONSTRATION DOCUMENT — it certifies nothing and carries no statutory weight.`
        : `Generated by ${env.appName}.`,
      M.left,
      PAGE.height - M.bottom + 37
    );
  }

  return Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
}

function rule(doc: jsPDF, y: number) {
  doc.setDrawColor(LINE).setLineWidth(0.5);
  doc.line(M.left, y, PAGE.width - M.right, y);
  return y;
}

function bottom(doc: jsPDF, fallback: number) {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;
}
