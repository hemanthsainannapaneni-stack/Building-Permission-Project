import 'server-only';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { prisma } from '@/server/db/prisma';
import { env } from '@/server/config/env';
import { notFound } from '@/server/http/errors';
import { applicationScope } from '@/server/auth/scope';
import type { AuthUser } from '@/server/auth/context';
import { isUuid } from '@/lib/utils';
import {
  KIND_META,
  currentCycle,
  isShortfallOpen,
  itemStatusLabel,
  kindLabel,
  statusLabel,
} from '@/lib/shortfalls';

/**
 * THE SHORTFALL LETTER — the document the applicant is actually sent.
 *
 * ── Why a real PDF, when the receipt and the scrutiny report are HTML ────
 *
 * Both of those carry a note saying a PDF needs a rendering library and that
 * adding one is a dependency decision rather than something to slip in. That
 * decision has since been made: `jspdf` and `jspdf-autotable` are project
 * dependencies. So the letter renders to PDF, which is what a letter that
 * leaves the building has to be — it is printed, signed for, and filed by
 * people who will never open a browser to read it.
 *
 * Nothing else moves. The receipt and the report keep their renderers and
 * their routes; when somebody wants those as PDF too, this file is the
 * pattern.
 *
 * ── It is rendered from the shortfall, and not stored ───────────────────
 *
 * Unlike a receipt or an approval order, a shortfall letter is not evidence of
 * an irreversible act, so there is no snapshot and no stored artefact to keep
 * immutable. It is a faithful printing of a record that is itself append-only:
 * the items cannot be edited away, the responses cannot be overwritten, and
 * every cycle stays on the shortfall. Re-printing the letter next year
 * produces the same letter, plus whatever has happened since — which is what
 * somebody re-printing it actually wants.
 *
 * ── A demo letter says so, on every page ────────────────────────────────
 *
 * DEMO_MODE stamps a diagonal watermark across the sheet and a line in the
 * footer. A letter that looks exactly like a real notice from a planning
 * authority is precisely the artefact that ends up in somebody's file and gets
 * acted on, so a demonstration is never allowed to print one that does not say
 * what it is.
 */

// A4 in points, and a margin wide enough to punch and file.
const PAGE = { width: 595.28, height: 841.89 };
const M = { left: 52, right: 52, top: 52, bottom: 58 };
const CONTENT_WIDTH = PAGE.width - M.left - M.right;
/// Whole points, so a table's explicit column widths can sum to it exactly.
/// A fractional remainder makes autoTable warn that the content overflows by
/// a quarter of a point, which is noise that hides a real overflow later.
const TABLE_WIDTH = Math.floor(CONTENT_WIDTH);

const INK = '#18181b';
const MUTED = '#52525b';
const LINE = '#d4d4d8';
const ACCENT = '#1d4ed8';
const DANGER = '#b91c1c';

// ═══════════════════════════════════════════════════════════════════════════
// Loading
// ═══════════════════════════════════════════════════════════════════════════

export type LetterModel = Awaited<ReturnType<typeof loadForLetter>>;

/**
 * Everything the letter prints, in one query, with the caller's row scope
 * merged in.
 *
 * Scope goes into the WHERE for the same reason it does everywhere else: a
 * letter is a readable copy of somebody's file, and a letter endpoint that
 * trusted an id would be the easiest way in the product to read one.
 */
async function loadForLetter(user: AuthUser, shortfallId: string) {
  if (!isUuid(shortfallId)) throw notFound('That shortfall could not be found.');

  const row = await prisma.shortfall.findFirst({
    where: {
      id: shortfallId,
      application: { deletedAt: null, ...applicationScope(user) },
    },
    select: {
      id: true,
      shortfallNumber: true,
      kind: true,
      mode: true,
      status: true,
      title: true,
      description: true,
      requiredAction: true,
      raisedAt: true,
      dueDate: true,
      notifiedAt: true,
      closedAt: true,
      closureRemarks: true,
      raisedAtStageCode: true,
      raisedByRoleKey: true,
      raisedBy: { select: { name: true, designation: true } },
      items: {
        orderBy: { displayOrder: 'asc' },
        select: {
          displayOrder: true,
          description: true,
          category: true,
          requiredAction: true,
          requiredDocument: true,
          remarks: true,
          status: true,
          isMandatory: true,
          amount: true,
          isResolved: true,
          documentType: { select: { name: true } },
        },
      },
      resolutions: { orderBy: { attemptNo: 'asc' }, select: { attemptNo: true } },
      feeDemands: {
        select: { demandNumber: true, status: true, totalAmount: true, dueDate: true },
      },
      applicationId: true,
      application: {
        select: {
          id: true,
          applicationNumber: true,
          submittedAt: true,
          applicationType: { select: { name: true } },
          zone: { select: { name: true } },
          applicant: { select: { name: true, address: true, phone: true, email: true } },
          ltp: { select: { name: true } },
          property: {
            select: {
              doorNo: true,
              plotNo: true,
              streetName: true,
              localityName: true,
              village: true,
              mandal: true,
              district: true,
              pincode: true,
              surveyNumbers: true,
              layoutName: true,
              plotAreaSqm: true,
            },
          },
        },
      },
    },
  });

  if (!row) throw notFound('That shortfall could not be found.');

  return { ...row, cycle: currentCycle(row.status, row.resolutions), isDemo: env.demoMode };
}

/** The site address, assembled from whatever parts the file actually has. */
function siteAddress(property: LetterModel['application']['property']): string {
  if (!property) return 'Not recorded';

  const line = [
    [property.doorNo, property.plotNo && `Plot ${property.plotNo}`].filter(Boolean).join(', '),
    property.streetName,
    property.localityName,
    property.layoutName,
    property.village,
    property.mandal,
    [property.district, property.pincode].filter(Boolean).join(' — '),
  ]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ');

  return line || 'Not recorded';
}

export function letterFilename(shortfallNumber: string): string {
  return `shortfall-letter-${shortfallNumber.replace(/[/\\]/g, '-')}.pdf`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════

/** Renders the letter and returns the PDF bytes. */
export async function renderShortfallLetter(
  user: AuthUser,
  shortfallId: string
): Promise<{ bytes: Buffer; filename: string; model: LetterModel }> {
  const model = await loadForLetter(user, shortfallId);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  let y = header(doc, model);
  y = reference(doc, model, y);
  y = addressee(doc, model, y);
  y = subject(doc, model, y);
  y = body(doc, model, y);
  y = deficiencies(doc, model, y);
  y = money(doc, model, y);
  y = instructions(doc, model, y);
  authority(doc, model, y);

  decorate(doc, model);

  return {
    bytes: Buffer.from(doc.output('arraybuffer') as ArrayBuffer),
    filename: letterFilename(model.shortfallNumber),
    model,
  };
}

/** The letterhead. */
function header(doc: jsPDF, model: LetterModel): number {
  doc.setFillColor(ACCENT);
  doc.rect(0, 0, PAGE.width, 6, 'F');

  doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(INK);
  doc.text(env.appName.toUpperCase(), M.left, M.top + 14);

  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(MUTED);
  doc.text('Building Permission Approval System', M.left, M.top + 30);
  doc.text(
    `${model.application.zone?.name ?? 'Head Office'} · ${model.application.applicationType.name}`,
    M.left,
    M.top + 43
  );

  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(DANGER);
  doc.text('SHORTFALL NOTICE', PAGE.width - M.right, M.top + 14, { align: 'right' });

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(MUTED);
  doc.text(kindLabel(model.kind).toUpperCase(), PAGE.width - M.right, M.top + 28, {
    align: 'right',
  });
  doc.text(`Cycle ${model.cycle}`, PAGE.width - M.right, M.top + 41, { align: 'right' });

  return rule(doc, M.top + 54);
}

/** Reference block — the numbers a clerk quotes back. */
function reference(doc: jsPDF, model: LetterModel, y: number): number {
  const rows: Array<[string, string]> = [
    ['Shortfall No.', model.shortfallNumber],
    ['Application No.', model.application.applicationNumber],
    ['Date', fmtDate(model.raisedAt)],
    ['Reply by', model.dueDate ? fmtDate(model.dueDate) : 'No date set'],
  ];

  const colWidth = CONTENT_WIDTH / 2;
  let top = y + 16;

  rows.forEach(([label, value], i) => {
    const x = M.left + (i % 2) * colWidth;
    const line = top + Math.floor(i / 2) * 26;

    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
    doc.text(label.toUpperCase(), x, line);
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
    doc.text(value, x, line + 12);
  });

  top += Math.ceil(rows.length / 2) * 26;
  return top;
}

/** Who it is addressed to, and about which site. */
function addressee(doc: jsPDF, model: LetterModel, y: number): number {
  let top = rule(doc, y + 4) + 16;

  const facts: Array<[string, string]> = [
    ['To (owner)', model.application.applicant?.name ?? 'Not recorded'],
    ['Licensed Technical Person', model.application.ltp?.name ?? 'Not recorded'],
    ['Site', siteAddress(model.application.property)],
    [
      'Survey / plot',
      [model.application.property?.surveyNumbers, model.application.property?.plotNo]
        .filter(Boolean)
        .join(' · ') || 'Not recorded',
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

/** The subject line. */
function subject(doc: jsPDF, model: LetterModel, y: number): number {
  let top = y + 6;

  doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(INK);
  const text = `Sub: ${model.title} — application ${model.application.applicationNumber}`;
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
  doc.text(lines, M.left, top);
  top += lines.length * 14 + 6;

  return rule(doc, top);
}

/** The officer's description of what is wrong. */
function body(doc: jsPDF, model: LetterModel, y: number): number {
  let top = y + 18;

  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(INK);

  const opening =
    `On scrutiny of the above application at the ${deskLabel(model.raisedAtStageCode)}, ` +
    `the following ${model.items.length === 1 ? 'deficiency has' : 'deficiencies have'} been observed. ` +
    `You are requested to rectify ${model.items.length === 1 ? 'it' : 'them'} and submit your reply ` +
    `${model.dueDate ? `on or before ${fmtDate(model.dueDate)}` : 'at the earliest'}.`;

  const openingLines = doc.splitTextToSize(opening, CONTENT_WIDTH) as string[];
  doc.text(openingLines, M.left, top);
  top += openingLines.length * 13 + 12;

  if (model.description) {
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(MUTED);
    doc.text('OBSERVATION', M.left, top);
    top += 12;

    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(INK);
    const lines = doc.splitTextToSize(model.description, CONTENT_WIDTH) as string[];
    doc.text(lines, M.left, top);
    top += lines.length * 13 + 10;
  }

  return top;
}

/** The numbered table of deficiencies — the substance of the letter. */
function deficiencies(doc: jsPDF, model: LetterModel, y: number): number {
  if (!model.items.length) return y;

  autoTable(doc, {
    startY: y + 4,
    margin: { left: M.left, right: M.right },
    head: [['#', 'Deficiency', 'Category', 'Required correction', 'Document required', 'Status']],
    body: model.items.map((item) => [
      String(item.displayOrder + 1),
      item.description + (item.isMandatory ? '' : '\n(not mandatory)'),
      item.category || '—',
      item.requiredAction || '—',
      item.requiredDocument || item.documentType?.name || '—',
      itemStatusLabel(item.status),
    ]),
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 5,
      lineColor: LINE,
      lineWidth: 0.5,
      textColor: INK,
      valign: 'top',
    },
    headStyles: {
      fillColor: '#f4f4f5',
      textColor: INK,
      fontStyle: 'bold',
      fontSize: 8,
      lineColor: LINE,
      lineWidth: 0.5,
    },
    // Explicit widths, summing to the printable width. Left to `auto`, the
    // Deficiency and Required-correction columns win every fight and the
    // Status column ends up too narrow to hold the word it exists to show.
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' },
      1: { cellWidth: 125 },
      2: { cellWidth: 68 },
      3: { cellWidth: 125 },
      4: { cellWidth: 95 },
      5: { cellWidth: 58 },
    },
    tableWidth: TABLE_WIDTH,
    theme: 'grid',
  });

  return tableBottom(doc, y);
}

/** The demand, when the shortfall asked for money. */
function money(doc: jsPDF, model: LetterModel, y: number): number {
  if (!model.feeDemands.length) return y;

  let top = y + 20;

  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text('Additional amount payable', M.left, top);
  top += 6;

  autoTable(doc, {
    startY: top,
    margin: { left: M.left, right: M.right },
    head: [['Demand No.', 'Amount (INR)', 'Payable by', 'Status']],
    body: model.feeDemands.map((demand) => [
      demand.demandNumber,
      fmtMoney(demand.totalAmount),
      demand.dueDate ? fmtDate(demand.dueDate) : '—',
      demand.status.replace(/_/g, ' '),
    ]),
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 5,
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
    columnStyles: { 1: { halign: 'right' } },
    theme: 'grid',
  });

  top = tableBottom(doc, top);

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(MUTED);
  const note = doc.splitTextToSize(
    'The shortfall cannot be closed until this amount is credited and verified against the demand. ' +
      'Payment may be made through the portal, and the receipt is issued automatically on settlement.',
    CONTENT_WIDTH
  ) as string[];
  doc.text(note, M.left, top + 12);

  return top + 12 + note.length * 12;
}

/** How to reply, and what happens if the applicant does not. */
function instructions(doc: jsPDF, model: LetterModel, y: number): number {
  let top = pageBreakIfNeeded(doc, y + 22, 170);

  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text('How to respond', M.left, top);
  top += 16;

  const steps = [
    `Sign in to the ${env.appName} portal and open application ${model.application.applicationNumber}.`,
    `Go to Shortfalls and open ${model.shortfallNumber}.`,
    model.kind === 'FEE'
      ? 'Pay the additional demand shown above, then record your response against each item.'
      : 'Upload the required document against each item and record your response.',
    'Submit the response. It reaches the officer who raised this notice immediately.',
    model.mode === 'BLOCKING'
      ? 'The application is held at your end until the response is submitted and accepted.'
      : 'The application continues to move, but approval is held until this shortfall is settled.',
  ];

  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(INK);
  steps.forEach((step, i) => {
    const lines = doc.splitTextToSize(`${i + 1}.  ${step}`, CONTENT_WIDTH - 10) as string[];
    doc.text(lines, M.left + 6, top);
    top += lines.length * 12 + 4;
  });

  top += 6;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(MUTED);
  const caveat = doc.splitTextToSize(
    model.dueDate
      ? `If no reply is received by ${fmtDate(model.dueDate)}, the application will remain pending and ` +
          'the delay will be recorded against the file. No application is rejected, and no permission is ' +
          'granted, merely because this date has passed.'
      : 'No response period has been set against this notice. The application remains pending until the ' +
          'deficiencies above are made good.',
    CONTENT_WIDTH
  ) as string[];
  doc.text(caveat, M.left, top);

  return top + caveat.length * 12;
}

/** Who signed it. */
function authority(doc: jsPDF, model: LetterModel, y: number): number {
  let top = pageBreakIfNeeded(doc, y + 30, 120);

  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(INK);
  doc.text('For and on behalf of', PAGE.width - M.right, top, { align: 'right' });
  top += 40;

  doc.setDrawColor(LINE).setLineWidth(0.5);
  doc.line(PAGE.width - M.right - 170, top, PAGE.width - M.right, top);
  top += 13;

  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
  doc.text(model.raisedBy?.name ?? 'Authorised officer', PAGE.width - M.right, top, {
    align: 'right',
  });
  top += 12;

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(MUTED);
  doc.text(
    model.raisedBy?.designation || deskLabel(model.raisedAtStageCode),
    PAGE.width - M.right,
    top,
    { align: 'right' }
  );
  top += 11;
  doc.text(env.appName, PAGE.width - M.right, top, { align: 'right' });

  // Said plainly rather than left for somebody to notice: this letter carries
  // no signature of any kind, and a document that looks signed and is not is
  // worse than one that is obviously unsigned.
  top += 22;
  doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(MUTED);
  doc.text(
    'This is a system-generated notice. It is not digitally signed.',
    M.left,
    top
  );

  return top;
}

/** The watermark and the footer, applied to every page once the text is laid. */
function decorate(doc: jsPDF, model: LetterModel) {
  const pages = doc.getNumberOfPages();

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);

    if (model.isDemo) {
      // Drawn UNDER nothing — jsPDF has no z-order — so it is drawn last, in a
      // colour light enough to read straight through. A watermark that
      // obscured the text would be the first thing somebody removed.
      doc.saveGraphicsState();
      doc.setFont('helvetica', 'bold').setFontSize(40).setTextColor('#fbdcdc');
      doc.text('DEMONSTRATION', PAGE.width / 2, PAGE.height / 2 - 10, {
        align: 'center',
        angle: 32,
      });
      doc.setFontSize(11).setTextColor('#fbdcdc');
      doc.text('NOT A STATUTORY NOTICE', PAGE.width / 2, PAGE.height / 2 + 36, {
        align: 'center',
        angle: 32,
      });
      doc.restoreGraphicsState();
    }

    doc.setDrawColor(LINE).setLineWidth(0.5);
    doc.line(M.left, PAGE.height - M.bottom + 12, PAGE.width - M.right, PAGE.height - M.bottom + 12);

    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
    doc.text(
      `${model.shortfallNumber} · ${model.application.applicationNumber} · ${statusLabel(model.status)}` +
        `${isShortfallOpen(model.status) ? '' : ' (settled)'}`,
      M.left,
      PAGE.height - M.bottom + 26
    );
    doc.text(`Page ${page} of ${pages}`, PAGE.width - M.right, PAGE.height - M.bottom + 26, {
      align: 'right',
    });

    doc.text(
      model.isDemo
        ? `Generated ${fmtDateTime(new Date())} by ${env.appName}. DEMONSTRATION DOCUMENT — it carries no statutory weight and no action may be taken on it.`
        : `Generated ${fmtDateTime(new Date())} by ${env.appName}.`,
      M.left,
      PAGE.height - M.bottom + 37
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Layout helpers
// ═══════════════════════════════════════════════════════════════════════════

function rule(doc: jsPDF, y: number): number {
  doc.setDrawColor(LINE).setLineWidth(0.5);
  doc.line(M.left, y, PAGE.width - M.right, y);
  return y;
}

/** Where autoTable finished, whichever page it finished on. */
function tableBottom(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return last?.finalY ?? fallback;
}

/** Starts a new page when `needed` points will not fit below `y`. */
function pageBreakIfNeeded(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PAGE.height - M.bottom) return y;
  doc.addPage();
  return M.top;
}

/** The desk, in the words the letter should use rather than the stage code. */
function deskLabel(stageCode: string): string {
  return stageCode
    .replace(/_REVIEW$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .concat(' desk');
}

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

const fmtMoney = (amount: unknown): string =>
  Number(amount ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export { KIND_META };
