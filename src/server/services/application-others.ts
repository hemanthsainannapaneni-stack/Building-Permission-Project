import 'server-only';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { isLtp, type AuthUser } from '@/server/auth/context';
import { forbidden, notFound } from '@/server/http/errors';
import { isUuid } from '@/lib/utils';
import { canApplicantAnswer } from '@/lib/checklist';
import type { UpdateOthersInput } from '@/lib/schemas/others';
import { audit } from './audit';
import { recordEvent, EVENT_TYPES } from './timeline';

type Meta = { ip?: string; userAgent?: string; correlationId?: string };

/**
 * THE "OTHERS" BLOCK — the six undertakings that belong to no other tab.
 *
 * Mortgage, car insurance, solar, rainwater harvesting, greening and the
 * special remarks. BBAS groups them together and so does this, because what
 * they have in common is procedural rather than topical: each is a condition
 * that travels with the permission, each is checked at occupancy rather than
 * at sanction, and none of them fits under drawings, documents, fees or
 * workflow.
 *
 * ── Required / proposed / provided ───────────────────────────────────────
 *
 * Three of the six carry that triple, and it is the most useful thing on the
 * screen. REQUIRED is the rule's answer, PROPOSED is the applicant's, PROVIDED
 * is the world's. The interesting states are the gaps:
 *
 *   required, not proposed          → a shortfall waiting to be raised
 *   required, proposed, not provided → the normal state before occupancy
 *   not required, proposed           → voluntary, and worth saying so
 *
 * A single "solar: yes/no" would make the first two indistinguishable, which
 * is the difference between a file that needs an officer and one that does
 * not.
 */

const SELECT = {
  id: true,
  applicationId: true,
  mortgageApplicable: true,
  mortgageNumber: true,
  mortgageDate: true,
  mortgageSubRegistrar: true,
  mortgagePortion: true,
  mortgageAreaSqm: true,
  mortgageDocumentId: true,
  insuranceApplicable: true,
  insurancePolicyNumber: true,
  insuranceDate: true,
  insuranceValidUpto: true,
  insuranceDocumentId: true,
  solarRequired: true,
  solarProposed: true,
  solarInstalled: true,
  solarCapacityKw: true,
  solarRemarks: true,
  rwhRequired: true,
  rwhProposed: true,
  rwhProvided: true,
  rwhRemarks: true,
  greeningRequired: true,
  greeningProposed: true,
  greeningProvided: true,
  treeCount: true,
  greeningRemarks: true,
  specialRemarks: true,
  updatedAt: true,
} as const;

async function requireApplication(user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That application could not be found.');

  const app = await prisma.application.findFirst({
    where: { id, deletedAt: null, ...applicationScope(user) },
    select: { id: true, applicationNumber: true, status: true, ltpUserId: true },
  });

  if (!app) throw notFound('That application could not be found.');
  return app;
}

/**
 * The Others block, with an empty one synthesised when no row exists yet.
 *
 * Synthesised and NOT created: a read must not write. Most applications never
 * touch this tab, and creating a row of defaults on every view would fill the
 * table with records that say nothing and make "has anybody looked at this?"
 * unanswerable. The row appears on the first save.
 */
export async function getApplicationOthers(user: AuthUser, applicationId: string) {
  const app = await requireApplication(user, applicationId);

  const [row, documents] = await Promise.all([
    prisma.applicationOthers.findUnique({
      where: { applicationId: app.id },
      select: SELECT,
    }),
    // Uploaded documents only — the mortgage deed and the policy can cite
    // something on the file and nothing else.
    prisma.applicationDocument.findMany({
      where: { applicationId: app.id, status: { not: 'NOT_UPLOADED' } },
      orderBy: { documentType: { name: 'asc' } },
      select: { id: true, status: true, documentType: { select: { name: true, code: true } } },
    }),
  ]);

  const isOwner = app.ltpUserId === user.id;

  return {
    application: {
      id: app.id,
      applicationNumber: app.applicationNumber,
      status: app.status,
    },
    /** True once somebody has actually entered something. */
    recorded: Boolean(row),
    others: row ?? emptyOthers(app.id),
    documents: documents.map((d) => ({
      id: d.id,
      name: d.documentType.name,
      code: d.documentType.code,
      status: d.status,
    })),
    canEdit: (!isLtp(user) || isOwner) && canApplicantAnswer(app.status),
    editBlockedReason:
      isLtp(user) && !isOwner
        ? 'You may only edit applications you filed.'
        : canApplicantAnswer(app.status)
          ? null
          : 'This application is with the department. You can edit again if it is returned to you.',
  };
}

export type ApplicationOthers = Awaited<ReturnType<typeof getApplicationOthers>>;

function emptyOthers(applicationId: string) {
  return {
    id: '',
    applicationId,
    mortgageApplicable: false,
    mortgageNumber: '',
    mortgageDate: null,
    mortgageSubRegistrar: '',
    mortgagePortion: '',
    mortgageAreaSqm: null,
    mortgageDocumentId: null,
    insuranceApplicable: false,
    insurancePolicyNumber: '',
    insuranceDate: null,
    insuranceValidUpto: null,
    insuranceDocumentId: null,
    solarRequired: false,
    solarProposed: false,
    solarInstalled: false,
    solarCapacityKw: null,
    solarRemarks: '',
    rwhRequired: false,
    rwhProposed: false,
    rwhProvided: false,
    rwhRemarks: '',
    greeningRequired: false,
    greeningProposed: false,
    greeningProvided: false,
    treeCount: null,
    greeningRemarks: '',
    specialRemarks: '',
    updatedAt: null,
  };
}

/**
 * Writes the keys that actually arrived, and no others.
 *
 * The screen saves one card at a time, so a request carrying only the solar
 * fields must leave the mortgage particulars alone. Spreading the parsed body
 * gives exactly that — Zod's `.optional()` drops absent keys rather than
 * defaulting them, so "not sent" and "sent as empty" stay distinguishable all
 * the way to the update.
 */
export async function updateApplicationOthers(
  user: AuthUser,
  applicationId: string,
  input: UpdateOthersInput,
  meta: Meta = {}
) {
  const app = await requireApplication(user, applicationId);

  if (isLtp(user) && app.ltpUserId !== user.id) {
    throw forbidden('You may only edit applications you filed.');
  }

  if (!canApplicantAnswer(app.status)) {
    throw forbidden(
      'This application is with the department. You can edit again if it is returned to you.'
    );
  }

  const before = await prisma.applicationOthers.findUnique({
    where: { applicationId: app.id },
    select: SELECT,
  });

  const after = await prisma.$transaction(async (tx) => {
    const row = await tx.applicationOthers.upsert({
      where: { applicationId: app.id },
      create: { applicationId: app.id, ...input },
      update: input,
      select: SELECT,
    });

    await recordEvent(tx, {
      applicationId: app.id,
      type: EVENT_TYPES.OTHERS_UPDATED,
      title: 'Other particulars updated',
      description: describeChange(input),
      actor: user,
      metadata: { fields: Object.keys(input) },
    });

    await audit(tx, {
      actor: user,
      action: 'APPLICATION_OTHERS_UPDATED',
      entityType: 'ApplicationOthers',
      entityId: row.id,
      applicationId: app.id,
      before,
      after: row,
      remarks: `${app.applicationNumber} — others`,
      ...meta,
    });

    return row;
  });

  return { ...(await getApplicationOthers(user, app.id)), others: after, recorded: true };
}

/**
 * A sentence for the timeline, naming the block that changed.
 *
 * "Other particulars updated" alone tells a reader nothing they can act on,
 * and the timeline is the narrative an applicant reads.
 */
function describeChange(input: UpdateOthersInput): string {
  const keys = Object.keys(input);
  const blocks = new Set<string>();

  for (const key of keys) {
    if (key.startsWith('mortgage')) blocks.add('mortgage');
    else if (key.startsWith('insurance')) blocks.add('car insurance');
    else if (key.startsWith('solar')) blocks.add('solar');
    else if (key.startsWith('rwh')) blocks.add('rainwater harvesting');
    else if (key.startsWith('greening') || key === 'treeCount') blocks.add('greening and trees');
    else if (key === 'specialRemarks') blocks.add('special remarks');
  }

  const list = [...blocks];
  if (!list.length) return 'The other particulars on this application were updated.';
  if (list.length === 1) return `The ${list[0]} particulars were updated.`;

  return `Updated: ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}.`;
}
