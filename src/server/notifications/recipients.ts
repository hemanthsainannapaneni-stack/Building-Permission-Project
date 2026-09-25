import 'server-only';
import { prisma } from '@/server/db/prisma';
import { settingBool } from '@/server/services/settings';
import type { Recipient } from './types';

/**
 * WHO gets told, per event.
 *
 * ── The rules are a table, and the table is the specification ────────────
 *
 * docs/07-subsystems.md M.2 lists the recipients for all twenty-two events;
 * this is that table as code. A dispatcher that worked out recipients inline
 * would put "the LTP is told about shortfalls" in a `switch` somewhere, and
 * the day somebody asks "who is told when a file goes overdue?" the answer
 * would be a code read rather than a look at one list.
 *
 * ── Two people can be behind one application ─────────────────────────────
 *
 * The LTP holds the account and does the work; the APPLICANT is the citizen
 * whose building it is. They are usually different people with different
 * phones. The LTP is always told, because they are the one who must act. The
 * applicant is told as well for the events that decide their permission —
 * approval, rejection, and a shortfall that has stopped their file — because a
 * citizen whose application is stuck is entitled to hear it from the
 * department rather than from their consultant, or not at all.
 *
 * `notify_applicant_directly` turns that off for a department that would
 * rather correspond only with the professional.
 */

/** The named rules an event may use. */
export type RecipientRule =
  | 'LTP'
  | 'APPLICANT'
  | 'RAISING_OFFICER'
  | 'ASSIGNED_OFFICER'
  | 'STAGE_ROLE'
  | 'ESCALATION_ROLE'
  | 'USER'
  /**
   * The developer (or professional) named on a registration that carries no
   * applicationId and no portal account. Read straight from the event's own
   * payload rather than looked up — there is no `applicants` row to join to.
   */
  | 'REGISTRATION_CONTACT';

/**
 * Which rules apply to which event, and whether the message is transactional.
 *
 * `mandatory` means the recipient may not switch it off. Kept deliberately
 * narrow: it covers the events that carry an obligation or a deadline, and
 * nothing that is merely informative.
 */
const RULES: Record<string, { rules: RecipientRule[]; mandatory?: boolean }> = {
  APPLICATION_CREATED: { rules: ['LTP'] },
  APPLICATION_SUBMITTED: { rules: ['LTP'] },
  DRAWING_UPLOADED: { rules: ['LTP'] },
  SCRUTINY_PASSED: { rules: ['LTP'] },
  SCRUTINY_FAILED: { rules: ['LTP'], mandatory: true },
  DOCUMENTS_PENDING: { rules: ['LTP'] },
  DOCUMENTS_COMPLETED: { rules: ['LTP'] },
  DOCUMENTS_COMPLETE: { rules: ['LTP'] },
  FEE_GENERATED: { rules: ['LTP', 'APPLICANT'], mandatory: true },
  PAYMENT_PENDING: { rules: ['LTP', 'APPLICANT'], mandatory: true },
  PAYMENT_SUCCESSFUL: { rules: ['LTP', 'APPLICANT'], mandatory: true },
  PAYMENT_SUCCESS: { rules: ['LTP', 'APPLICANT'], mandatory: true },
  PAYMENT_FAILED: { rules: ['LTP'], mandatory: true },

  APPLICATION_FORWARDED: { rules: ['LTP'] },
  APPLICATION_RETURNED: { rules: ['LTP'], mandatory: true },
  TASK_ASSIGNED: { rules: ['ASSIGNED_OFFICER', 'STAGE_ROLE'] },
  // The officer who now holds it, and nobody else. The applicant does not
  // need to be told which clerk has their file, and telling them invites a
  // telephone call to that clerk.
  APPLICATION_ASSIGNED: { rules: ['ASSIGNED_OFFICER'] },
  // Work waiting at a desk. Addressed to the desk rather than to a person,
  // because an unclaimed file has no person yet — which is precisely the
  // situation worth announcing.
  REVIEW_REQUIRED: { rules: ['ASSIGNED_OFFICER', 'STAGE_ROLE'] },
  APPROVAL_REQUIRED: { rules: ['ASSIGNED_OFFICER', 'STAGE_ROLE'] },

  // Shortfalls
  SHORTFALL_RAISED: { rules: ['LTP', 'APPLICANT'], mandatory: true },
  SHORTFALL_RESPONDED: { rules: ['RAISING_OFFICER'] },
  SHORTFALL_RESOLVED: { rules: ['LTP', 'APPLICANT'], mandatory: true },
  SHORTFALL_REJECTED: { rules: ['LTP', 'APPLICANT'], mandatory: true },

  // Decisions
  APPLICATION_APPROVED: { rules: ['LTP', 'APPLICANT'], mandatory: true },
  APPLICATION_REJECTED: { rules: ['LTP', 'APPLICANT'], mandatory: true },
  ORDER_ISSUED: { rules: ['LTP', 'APPLICANT'], mandatory: true },

  // SLA
  SLA_DUE_SOON: { rules: ['ASSIGNED_OFFICER'] },
  SLA_OVERDUE: { rules: ['ASSIGNED_OFFICER', 'ESCALATION_ROLE'] },
  SLA_BREACHED: { rules: ['ASSIGNED_OFFICER', 'ESCALATION_ROLE'] },

  // ── Declared for later phases ─────────────────────────────────────────
  //
  // Nothing emits these yet. The rules exist so that the module that
  // eventually does emit them does not have to decide who hears about them,
  // which is a policy question and not an implementation detail.
  INSPECTION_DUE: { rules: ['ASSIGNED_OFFICER', 'LTP'], mandatory: true },
  // Emitted since Phase 9 (NOTIFY_WORK_COMMENCEMENT). STAGE_ROLE resolves to
  // nobody for it: an approved file sits at no desk, and the engine's payload
  // names none. The department sees it on the Work Initiated register.
  WORK_INITIATED: { rules: ['LTP', 'APPLICANT', 'STAGE_ROLE'] },
  OCCUPANCY_SUBMITTED: { rules: ['LTP', 'APPLICANT', 'STAGE_ROLE'], mandatory: true },

  // Developer registration (Phase 11). STAGE_ROLE addresses whichever desk
  // the row now sits at (payload.assignedRoleKey = currentDeskRoleKey, set by
  // the service after every move); REGISTRATION_CONTACT addresses the
  // developer directly, by the particulars on the registration.
  DEVELOPER_REGISTRATION_SUBMITTED: { rules: ['STAGE_ROLE'] },
  DEVELOPER_REGISTRATION_SHORTFALL_RAISED: { rules: ['STAGE_ROLE', 'REGISTRATION_CONTACT'], mandatory: true },
  DEVELOPER_REGISTRATION_RESPONSE_RECEIVED: { rules: ['STAGE_ROLE'] },
  DEVELOPER_REGISTRATION_REVIEW_REQUIRED: { rules: ['STAGE_ROLE'] },
  DEVELOPER_REGISTRATION_APPROVED: { rules: ['REGISTRATION_CONTACT'], mandatory: true },
  DEVELOPER_REGISTRATION_REJECTED: { rules: ['REGISTRATION_CONTACT'], mandatory: true },
  DEVELOPER_REGISTRATION_RENEWAL_DUE: { rules: ['REGISTRATION_CONTACT'], mandatory: true },

  USER_CREATED: { rules: ['USER'], mandatory: true },
  PASSWORD_RESET: { rules: ['USER'], mandatory: true },
};

export const isMandatory = (eventCode: string): boolean => RULES[eventCode]?.mandatory ?? false;

export const isKnownEvent = (eventCode: string): boolean => eventCode in RULES;

type Payload = Record<string, unknown>;

/**
 * Resolves everybody who should hear about one event.
 *
 * De-duplicated by user id and then by address, because the LTP who filed an
 * application is quite often also the contact on it, and one person should not
 * receive the same SMS twice because they appear under two rules.
 */
export async function resolveRecipients(
  eventCode: string,
  applicationId: string | null,
  payload: Payload
): Promise<Recipient[]> {
  const rule = RULES[eventCode];
  if (!rule) return [];

  const mandatory = rule.mandatory ?? false;
  const found: Recipient[] = [];

  const application = applicationId
    ? await prisma.application.findUnique({
        where: { id: applicationId },
        select: {
          id: true,
          ltpUserId: true,
          zoneId: true,
          ltp: { select: { id: true, name: true, email: true, phone: true } },
          applicant: { select: { name: true, email: true, phone: true } },
        },
      })
    : null;

  for (const name of rule.rules) {
    switch (name) {
      case 'LTP': {
        if (!application?.ltp) break;
        found.push({
          userId: application.ltp.id,
          name: application.ltp.name,
          email: application.ltp.email,
          phone: application.ltp.phone ?? '',
          reason: 'The licensed technical person who filed the application',
          mandatory,
        });
        break;
      }

      case 'APPLICANT': {
        if (!application?.applicant) break;
        if (!(await settingBool('notify_applicant_directly', true))) break;

        const { name: applicantName, email, phone } = application.applicant;
        // No account, so no in-app row — the adapter records that honestly.
        if (!email && !phone) break;

        found.push({
          userId: null,
          name: applicantName ?? 'Applicant',
          email: email ?? '',
          phone: phone ?? '',
          reason: 'The applicant named on the application',
          mandatory,
        });
        break;
      }

      case 'RAISING_OFFICER': {
        const officerId = String(payload.raisedById ?? '');
        if (!officerId) break;
        const officer = await activeUser(officerId);
        if (officer) found.push({ ...officer, reason: 'Raised the shortfall', mandatory });
        break;
      }

      case 'ASSIGNED_OFFICER': {
        const officerId = String(payload.assignedUserId ?? '');
        if (!officerId) break;
        const officer = await activeUser(officerId);
        if (officer) found.push({ ...officer, reason: 'Holds the task', mandatory });
        break;
      }

      case 'STAGE_ROLE': {
        // Only when nobody holds it personally: telling a whole desk about a
        // file one of them has already claimed is how an inbox becomes noise.
        if (payload.assignedUserId) break;
        // Comma-separated where several roles share the next step's capability
        // (a register desk's `currentDeskRoleKey`, e.g. developer registration) —
        // every one of them is worth telling, the same as a single role is.
        const roleKeys = String(payload.assignedRoleKey ?? '').split(',').map((k) => k.trim()).filter(Boolean);
        for (const roleKey of roleKeys) {
          for (const officer of await usersInRole(roleKey, application?.zoneId ?? null)) {
            found.push({ ...officer, reason: `Works at the ${roleKey} desk`, mandatory });
          }
        }
        break;
      }

      case 'REGISTRATION_CONTACT': {
        const name = String(payload.contactName ?? '');
        const email = String(payload.contactEmail ?? '');
        const phone = String(payload.contactPhone ?? '');
        // No account, so no in-app row — the adapter records that honestly.
        if (!name || (!email && !phone)) break;
        found.push({ userId: null, name, email, phone, reason: 'Named on the registration', mandatory });
        break;
      }

      case 'ESCALATION_ROLE': {
        const roleKey = String(payload.escalateToRoleKey ?? '');
        if (!roleKey) break;
        for (const officer of await usersInRole(roleKey, application?.zoneId ?? null)) {
          found.push({ ...officer, reason: `Supervises the ${roleKey} desk`, mandatory });
        }
        break;
      }

      case 'USER': {
        const userId = String(payload.userId ?? '');
        if (!userId) break;
        const user = await activeUser(userId);
        if (user) found.push({ ...user, reason: 'The account holder', mandatory });
        break;
      }
    }
  }

  return dedupe(found);
}

async function activeUser(id: string) {
  const user = await prisma.user.findFirst({
    where: { id, status: 'ACTIVE', deletedAt: null },
    select: { id: true, name: true, email: true, phone: true },
  });

  if (!user) return null;
  return { userId: user.id, name: user.name, email: user.email, phone: user.phone ?? '' };
}

/** Officers holding a role, narrowed to the zone when the file has one. */
async function usersInRole(roleKey: string, zoneId: string | null) {
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { key: roleKey } } },
      ...(zoneId
        ? { OR: [{ primaryZoneId: zoneId }, { jurisdictions: { some: { zoneId } } }] }
        : {}),
    },
    select: { id: true, name: true, email: true, phone: true },
    // A city-wide role with no zone filter could be a long list; a desk is not.
    take: 25,
  });

  return users.map((u) => ({
    userId: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? '',
  }));
}

function dedupe(recipients: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];

  for (const recipient of recipients) {
    // Identity first, then address: the same person under two rules is one
    // recipient, and so is an applicant whose phone is the LTP's.
    const key = recipient.userId
      ? `user:${recipient.userId}`
      : `addr:${recipient.email.toLowerCase()}|${recipient.phone}`;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(recipient);
  }

  return out;
}
