import 'server-only';
import { DEMO_NOTICE_NOTE } from '@/lib/show-cause';
import { DEMO_ORDER_NOTE } from '@/lib/revocation';
import { OUTWARD_DOCUMENT_LABEL, type OutwardDocumentType } from '@/lib/outward';

/**
 * The DEMO documents: the show cause notice, the revocation order and a cover
 * sheet for anything else in Outward.
 *
 * Rendered as self-contained HTML, served with a sandboxing CSP, and stamped
 * DEMO on every page. The wording is deliberately neutral: it states what the
 * department recorded and asks for a response, and cites no section of any
 * Act — this project has not been given the statutory text, and a demo that
 * invented one would be teaching the wrong law.
 */

const esc = (v: string) =>
  v.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);

const day = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

function page(title: string, body: string, note: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{margin:0;background:#f1f5f9;font:15px/1.6 Georgia,'Times New Roman',serif;color:#0f172a}
  .sheet{position:relative;max-width:760px;margin:24px auto;background:#fffdf7;border:1px solid #cbd5e1;padding:56px 64px;overflow:hidden}
  .wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
  .wm span{transform:rotate(-28deg);font:800 120px system-ui,sans-serif;color:#dc2626;opacity:.08;letter-spacing:.1em}
  h1{font-size:22px;text-align:center;margin:0 0 4px;letter-spacing:.04em;text-transform:uppercase}
  .sub{text-align:center;color:#475569;font-size:13px;margin:0 0 28px;font-family:system-ui,sans-serif}
  .meta{display:grid;grid-template-columns:170px 1fr;gap:4px 12px;font-size:14px;margin:0 0 24px;font-family:system-ui,sans-serif}
  .meta dt{color:#475569}.meta dd{margin:0;font-weight:600}
  h2{font-size:15px;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.05em;color:#334155}
  p{margin:0 0 10px}
  ol{margin:0 0 10px;padding-left:22px}
  .sign{margin-top:48px;text-align:right}
  .sign .name{font-weight:700}
  .note{margin-top:40px;background:#fef3c7;color:#92400e;padding:10px 14px;font:12px/1.5 system-ui,sans-serif}
  .note b{display:block;font-size:12px;letter-spacing:.06em}
</style></head>
<body><div class="sheet"><div class="wm"><span>DEMO</span></div>
${body}
<div class="note"><b>NOT A REAL DOCUMENT</b>${esc(note)}</div>
</div></body></html>`;
}

const meta = (rows: Array<[string, string]>) =>
  `<dl class="meta">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd>`).join('')}</dl>`;

const paragraphs = (text: string) =>
  text
    .split(/\n{1,}/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `<p>${esc(t)}</p>`)
    .join('');

export type NoticeDoc = {
  noticeNumber: string;
  applicationNumber: string;
  orderNumber: string;
  recipient: string;
  address: string;
  site: string;
  reason: string;
  violation: string;
  issuedAt: Date;
  responseDueDate: Date;
  issuedByName: string;
  issuedByRole: string;
  outwardNumber: string;
};

export function renderShowCauseNotice(d: NoticeDoc): string {
  const body = `
<h1>Show Cause Notice</h1>
<p class="sub">Building Permission — Nirman demonstration</p>
${meta([
  ['Notice number', d.noticeNumber],
  ['Outward number', d.outwardNumber],
  ['Date of issue', day(d.issuedAt)],
  ['Application', d.applicationNumber],
  ...(d.orderNumber ? ([['Permission (BPO)', d.orderNumber]] as Array<[string, string]>) : []),
  ['Site', d.site],
])}
<p>To,<br><strong>${esc(d.recipient)}</strong>${d.address ? `<br>${esc(d.address)}` : ''}</p>
<h2>Observation</h2>
${paragraphs(d.violation)}
<h2>Reason for this notice</h2>
${paragraphs(d.reason)}
<h2>What you are asked to do</h2>
<p>You are requested to show cause, in writing and with any supporting documents, why the observation above should not be acted upon, on or before <strong>${esc(day(d.responseDueDate))}</strong>.</p>
<p>Your response will be considered by the reviewing officer before any decision is taken on this matter.</p>
<div class="sign"><div class="name">${esc(d.issuedByName)}</div><div>${esc(d.issuedByRole)}</div></div>`;
  return page(`Show cause notice ${d.noticeNumber}`, body, DEMO_NOTICE_NOTE);
}

export type RevocationOrderDoc = {
  revocationOrderNumber: string;
  revocationNumber: string;
  applicationNumber: string;
  orderNumber: string;
  approvedAt: Date | null;
  recipient: string;
  address: string;
  site: string;
  reason: string;
  grounds: string[];
  showCauseNumber: string;
  decisionRemarks: string;
  decidedAt: Date | null;
  decidedByName: string;
  decidedByRole: string;
  outwardNumber: string;
};

export function renderRevocationOrder(d: RevocationOrderDoc): string {
  const body = `
<h1>Order of Revocation</h1>
<p class="sub">Building Permission — Nirman demonstration</p>
${meta([
  ['Order number', d.revocationOrderNumber],
  ['Outward number', d.outwardNumber],
  ['Date', day(d.decidedAt)],
  ['Proceeding', d.revocationNumber],
  ['Application', d.applicationNumber],
  ['Permission (BPO)', d.orderNumber],
  ['Permission granted on', day(d.approvedAt)],
  ...(d.showCauseNumber ? ([['Show cause notice', d.showCauseNumber]] as Array<[string, string]>) : []),
  ['Site', d.site],
])}
<p>To,<br><strong>${esc(d.recipient)}</strong>${d.address ? `<br>${esc(d.address)}` : ''}</p>
<h2>Reference</h2>
${paragraphs(d.reason)}
<h2>Grounds recorded</h2>
<ol>${d.grounds.map((g) => `<li>${esc(g)}</li>`).join('')}</ol>
<h2>Decision</h2>
${paragraphs(d.decisionRemarks)}
<p>The building permission referred to above stands revoked with effect from the date of this order. The record of its grant is retained.</p>
<div class="sign"><div class="name">${esc(d.decidedByName)}</div><div>${esc(d.decidedByRole)}</div></div>`;
  return page(`Revocation order ${d.revocationOrderNumber}`, body, DEMO_ORDER_NOTE);
}

export type CoverDoc = {
  outwardNumber: string;
  documentType: string;
  documentReference: string;
  subject: string;
  applicationNumber: string;
  recipient: string;
  address: string;
  assignedDate: Date;
  remarks: string;
};

/** For a document Outward did not generate itself — a BPO, a letter. */
export function renderOutwardCover(d: CoverDoc): string {
  const type = OUTWARD_DOCUMENT_LABEL[d.documentType as OutwardDocumentType] ?? d.documentType;
  const body = `
<h1>Outward Dispatch Slip</h1>
<p class="sub">${esc(type)}</p>
${meta([
  ['Outward number', d.outwardNumber],
  ['Date assigned', day(d.assignedDate)],
  ['Document', type],
  ['Document reference', d.documentReference],
  ['Application / file', d.applicationNumber],
  ['Subject', d.subject],
])}
<p>To,<br><strong>${esc(d.recipient)}</strong>${d.address ? `<br>${esc(d.address)}` : ''}</p>
${d.remarks ? `<h2>Remarks</h2>${paragraphs(d.remarks)}` : ''}
<p>The document named above is enclosed.</p>`;
  return page(`Outward ${d.outwardNumber}`, body, 'DEMO DOCUMENT — a dispatch slip generated by the Nirman demonstration.');
}

/** A labelled placeholder for an attachment that has no stored file. */
export function renderDemoAttachment(fileName: string, context: string): string {
  const body = `<h1>Attachment</h1><p class="sub">${esc(context)}</p>${meta([['File', fileName]])}
<p>This is a demonstration placeholder. No file was uploaded; it stands in for a supporting document so the flow can be shown.</p>`;
  return page(fileName, body, 'DEMO PLACEHOLDER — no file was uploaded.');
}

export const DOCUMENT_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  // Inline styles only: no script, no network, nothing to execute.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'Cache-Control': 'private, max-age=30',
} as const;
