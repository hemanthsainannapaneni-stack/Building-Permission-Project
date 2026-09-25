import 'server-only';
import { prisma } from '@/server/db/prisma';
import { dispatchOutbox } from '@/server/notifications/dispatcher';
import { verifyAuditChain } from '@/server/services/audit';
import { scanner } from '@/server/services/antivirus';
import { quarantineFile } from '@/server/services/files';
import { storage } from '@/server/storage';
import { runScrutiny, pollScrutiny, failScrutiny } from '@/server/services/scrutiny';
import { ensureReport } from '@/server/services/scrutiny-report';
import { reconcilePayments } from '@/server/services/payments';
import { ensureReceipt } from '@/server/services/receipts';
import { advanceOrder, ensureApprovalOrder } from '@/server/services/approval-orders';
import { storeApprovalOrderPdf } from '@/server/services/approval-order-pdf';
import { ORDER_STATUS } from '@/lib/approval-orders';
import { sweepSla } from '@/server/workflow/sla';
import { expireLapsedDeveloperRegistrations, notifyDeveloperRenewalsDue } from '@/server/services/developer-registrations';
import { expireLapsedProfessionalRegistrations } from '@/server/services/professional-registrations';
import { JOB_TYPES, type ClaimedJob } from './queue';

/**
 * The handler registry.
 *
 * Phase 0 registers the handlers whose infrastructure exists: outbox dispatch,
 * the audit-chain check, and the shortfall recount. The rest are registered as
 * their phase lands — an unregistered type fails loudly rather than silently
 * succeeding, which is what we want while the system is half-built.
 */

export type JobHandler = (job: ClaimedJob) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function register(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export function getHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}

export function registeredTypes(): string[] {
  return [...handlers.keys()].sort();
}

// ── DISPATCH_OUTBOX ──────────────────────────────────────────────────────
//
// Every notification in the system leaves through here. The business
// transaction wrote an outbox row and committed; this turns that durable fact
// into messages on three channels, and records what happened to each one.
//
// Nothing here knows what an event MEANS. Recipients come from a table,
// wording from a template, and delivery from an adapter — so adding an event
// is a rule and a template, not a change to the worker.

register(JOB_TYPES.DISPATCH_OUTBOX, async () => {
  const report = await dispatchOutbox(25);

  if (report.failed || report.errored) {
    // Loud, because a failed notification is invisible from the outside: the
    // applicant simply never hears anything, and nobody finds out until they
    // ring up. The delivery log has the detail; this is what puts it in front
    // of whoever is watching the worker.
    console.warn(
      `[notifications] ${report.events} events · ${report.sent} sent · ` +
        `${report.failed} failed · ${report.skipped} skipped · ${report.errored} errored`
    );
  }
});

// ── VERIFY_AUDIT_CHAIN ───────────────────────────────────────────────────

register(JOB_TYPES.VERIFY_AUDIT_CHAIN, async () => {
  const result = await verifyAuditChain();
  if (!result.ok) {
    // Loud on purpose. A broken chain means a row was altered outside the
    // application, which is an incident, not a warning.
    console.error(
      `[audit] CHAIN BROKEN after ${result.checked} rows, first bad row: ${result.brokenAtId}`
    );
  }
});

// ── RECOUNT_SHORTFALLS ───────────────────────────────────────────────────
//
// applications.openShortfalls is a denormalised cache. The approval guard
// re-counts live inside its transaction, so a stale value can never authorise
// an approval — but a divergence still means something is wrong, and we want
// to know rather than to rely on the guard alone.

register(JOB_TYPES.RECOUNT_SHORTFALLS, async () => {
  const apps = await prisma.application.findMany({
    where: { deletedAt: null },
    select: { id: true, openShortfalls: true },
  });

  for (const app of apps) {
    const actual = await prisma.shortfall.count({
      where: {
        applicationId: app.id,
        status: { notIn: ['RESOLVED', 'CANCELLED'] },
      },
    });

    if (app.openShortfalls !== actual) {
      console.warn(`[shortfalls] recount ${app.id}: cached=${app.openShortfalls} actual=${actual}`);
      await prisma.application.update({
        where: { id: app.id },
        data: { openShortfalls: actual },
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3 — files and scrutiny
// ═══════════════════════════════════════════════════════════════════════════

// ── SCAN_FILE ────────────────────────────────────────────────────────────
//
// Every upload is written PENDING and the download route refuses to serve
// anything not yet cleared, so this job is what unblocks a file. With no
// scanner configured it marks SKIPPED — never CLEAN, which would claim a check
// that did not happen.

register(JOB_TYPES.SCAN_FILE, async (job) => {
  const fileObjectId = String(job.payload.fileObjectId ?? '');
  if (!fileObjectId) return;

  const file = await prisma.fileObject.findFirst({
    where: { id: fileObjectId, deletedAt: null },
    select: { id: true, storageKey: true, originalName: true, scanStatus: true },
  });

  // Gone, or already decided. Re-scanning a settled file would be busywork.
  if (!file || file.scanStatus !== 'PENDING') return;

  let bytes: Buffer;
  try {
    bytes = await storage.get(file.storageKey);
  } catch {
    // The row exists but the object does not. FAILED rather than SKIPPED: the
    // file cannot be served, and pretending otherwise would hand a user a
    // broken download.
    await prisma.fileObject.update({
      where: { id: file.id },
      data: { scanStatus: 'FAILED', scanDetail: 'Stored object could not be read.' },
    });
    return;
  }

  const { status, detail } = await scanner.scan({ bytes, filename: file.originalName });

  if (status === 'INFECTED') {
    // Quarantine removes the bytes and soft-deletes the row, so an infected
    // upload cannot be downloaded by anyone, including the person who sent it.
    await quarantineFile(prisma, file.id, detail);
    console.warn(`[antivirus] quarantined ${file.id} (${file.originalName}): ${detail}`);
    return;
  }

  await prisma.fileObject.update({
    where: { id: file.id },
    data: { scanStatus: status, scanDetail: detail.slice(0, 500) },
  });
});

// ── RUN_SCRUTINY ─────────────────────────────────────────────────────────
//
// Submits a queued request to the engine. Throwing hands the job back to the
// queue for exponential backoff; on the LAST attempt the request is marked
// ERRORED, which returns the application to DRAWING_UPLOADED rather than
// failing it — the engine broke, the drawing was never judged.

register(JOB_TYPES.RUN_SCRUTINY, async (job) => {
  const scrutinyRequestId = String(job.payload.scrutinyRequestId ?? '');
  if (!scrutinyRequestId) return;

  try {
    await runScrutiny(scrutinyRequestId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (job.attempts >= job.maxAttempts) {
      await failScrutiny(scrutinyRequestId, message);
      return; // Settled. Do not also dead-letter the job.
    }
    throw err;
  }
});

// ── POLL_SCRUTINY ────────────────────────────────────────────────────────

register(JOB_TYPES.POLL_SCRUTINY, async (job) => {
  const scrutinyRequestId = String(job.payload.scrutinyRequestId ?? '');
  if (!scrutinyRequestId) return;

  try {
    await pollScrutiny(scrutinyRequestId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (job.attempts >= job.maxAttempts) {
      await failScrutiny(scrutinyRequestId, message);
      return;
    }
    throw err;
  }
});

// ── RENDER_SCRUTINY_REPORT ───────────────────────────────────────────────
//
// Warms the report so it is ready the moment an LTP clicks Download. The
// download route calls the same function, so a worker that is down delays the
// first click rather than breaking it.

register(JOB_TYPES.RENDER_SCRUTINY_REPORT, async (job) => {
  const scrutinyResultId = String(job.payload.scrutinyResultId ?? '');
  if (!scrutinyResultId) return;
  await ensureReport(scrutinyResultId);
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 5 — payments
// ═══════════════════════════════════════════════════════════════════════════

// ── RECONCILE_PAYMENTS ───────────────────────────────────────────────────
//
// The sweep that makes the return page a convenience rather than a load-bearing
// part of the design. Every unsettled payment old enough to be worth asking
// about is verified against the gateway directly — so a payer who closed the
// browser, a webhook that never arrived, and a gateway that answered an hour
// late all resolve without anybody noticing they went wrong.
//
// Deliberately does NOT throw on a payment that fails to settle:
// `reconcilePayments` handles each one in its own transaction and counts the
// errors, because the payment that throws is the one most in need of the sweep
// running again tomorrow. A single bad row must not dead-letter the job that
// would have fixed it.

register(JOB_TYPES.RECONCILE_PAYMENTS, async () => {
  const report = await reconcilePayments();

  if (report.settled || report.timedOut || report.errors) {
    console.log(
      `[payments] reconcile: ${report.examined} examined · ${report.settled} settled · ` +
        `${report.timedOut} timed out · ${report.stillOpen} still open · ${report.errors} errored`
    );
  }
});

// ── RENDER_RECEIPT ───────────────────────────────────────────────────────
//
// Warms the printable receipt so it is ready the moment an LTP clicks
// Download. The download route calls the same function, so a worker that is
// down delays the first click rather than breaking it.

register(JOB_TYPES.RENDER_RECEIPT, async (job) => {
  const paymentReceiptId = String(job.payload.paymentReceiptId ?? '');
  if (!paymentReceiptId) return;
  await ensureReceipt(paymentReceiptId);
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 6 — workflow
// ═══════════════════════════════════════════════════════════════════════════

// ── SWEEP_SLA ────────────────────────────────────────────────────────────
//
// Re-derives every live clock and notifies once per transition into a worse
// state. Deliberately the ONLY thing that writes an SLA status outside a
// transition: passing a due date has no effect on the workflow (docs R.1.1),
// so this job informs people and changes nothing about what an officer may do.

register(JOB_TYPES.SWEEP_SLA, async () => {
  const report = await sweepSla();

  if (report.dueSoon || report.overdue) {
    console.log(
      `[sla] sweep: ${report.examined} live · ${report.dueSoon} due soon · ` +
        `${report.overdue} overdue · ${report.notified} notified`
    );
  }
});

// ── EXPIRE_DEVELOPER_REGISTRATIONS ───────────────────────────────────────
//
// An approved developer registration past its validity becomes EXPIRED, with
// an event and an audit row each. Idempotent; see the service.

register(JOB_TYPES.EXPIRE_DEVELOPER_REGISTRATIONS, async () => {
  const report = await expireLapsedDeveloperRegistrations();
  if (report.expired) console.log(`[developers] expiry sweep: ${report.expired} of ${report.examined} expired`);
});

register(JOB_TYPES.NOTIFY_DEVELOPER_RENEWALS_DUE, async () => {
  const report = await notifyDeveloperRenewalsDue();
  if (report.notified) console.log(`[developers] renewal-due sweep: ${report.notified} of ${report.examined} notified`);
});

register(JOB_TYPES.EXPIRE_PROFESSIONAL_REGISTRATIONS, async () => {
  const report = await expireLapsedProfessionalRegistrations();
  if (report.expired) console.log(`[professionals] expiry sweep: ${report.expired} of ${report.examined} expired`);
});

// ── RENDER_APPROVAL_ORDER ────────────────────────────────────────────────
//
// Enqueued by the workflow's GENERATE_APPROVAL_ORDER effect, inside the
// approving transaction. Separate from the approval on purpose: issuing the
// order must not be able to fail the decision, and the decision must not have
// to wait for it. The job is idempotent on the application, so a retry finds
// the order it already issued rather than issuing a second permission.

register(JOB_TYPES.RENDER_APPROVAL_ORDER, async (job) => {
  const applicationId = String(job.payload.applicationId ?? '');
  if (!applicationId) return;

  const issuedById = String(job.payload.issuedById ?? '');
  const order = await ensureApprovalOrder(applicationId, issuedById);

  // Render the document and carry the draft to GENERATED. The job does these
  // two and stops: APPROVED and ISSUED are acts of a person, and a background
  // worker that issued permissions on its own would be a worker that grants
  // them. The applicant hears nothing until somebody issues it.
  if (order.status !== ORDER_STATUS.DRAFT) return;

  await storeApprovalOrderPdf(order.id);
  await advanceOrder({
    orderId: order.id,
    to: ORDER_STATUS.GENERATED,
    actor: { id: issuedById, name: 'system', roleKeys: ['SYSTEM'] },
    remarks: 'Rendered by the approval-order job.',
  });
});
