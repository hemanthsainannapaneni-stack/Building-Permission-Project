import 'server-only';
import { prisma } from '@/server/db/prisma';
import { env } from '@/server/config/env';

/**
 * READY-MADE REFERENCES FOR A DEMONSTRATION.
 *
 * A stakeholder opening the status page cannot be expected to know an
 * application number, so in DEMO MODE ONLY the pages offer a few real ones to
 * try. Outside demo mode this returns nothing: a public list of application
 * numbers is precisely the enumeration the exact-match lookups exist to
 * prevent, and it is acceptable here only because every record in a demo
 * database is fictional.
 */

export type SampleApplication = { applicationNumber: string; permissionType: string; statusHint: string; mobileHint: string };

const HINT: Record<string, string> = {
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  FEE_GENERATED: 'Fee demand raised',
  PAYMENT_PENDING: 'Payment pending',
  PAYMENT_FAILED: 'Payment failed',
};

export async function sampleApplications(opts: { payable?: boolean; take?: number } = {}): Promise<SampleApplication[]> {
  if (!env.demoMode) return [];
  const take = opts.take ?? 4;

  const rows = await prisma.application.findMany({
    where: opts.payable
      ? { deletedAt: null, status: { in: ['FEE_GENERATED', 'PAYMENT_FAILED', 'PAYMENT_PENDING'] }, fees: { some: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } } }, applicant: { phone: { not: null } } }
      : { deletedAt: null, submittedAt: { not: null }, applicant: { phone: { not: null } } },
    orderBy: { updatedAt: 'desc' },
    // Spread across statuses rather than the newest few, which are usually all alike.
    take: 80,
    select: { applicationNumber: true, status: true, applicationType: { select: { name: true } }, applicant: { select: { phone: true } } },
  });

  // One of each status first, then whatever is left, so the offer shows range.
  const picked: typeof rows = [];
  const statuses = new Set<string>();
  for (const r of rows) {
    if (!statuses.has(r.status)) {
      statuses.add(r.status);
      picked.push(r);
    }
  }
  for (const r of rows) if (picked.length < take && !picked.includes(r)) picked.push(r);

  return picked.slice(0, take).map((r) => ({
    applicationNumber: r.applicationNumber,
    permissionType: r.applicationType.name,
    statusHint: HINT[r.status] ?? 'In process',
    mobileHint: (r.applicant?.phone ?? '').replace(/\D/g, '').slice(-4),
  }));
}
