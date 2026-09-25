import 'server-only';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/db/prisma';
import { ROLES } from '@/lib/constants';
import { getPublicApplicationStatus } from './status';
import { getPublicDeveloperStatus, getPublicLtp } from './registers';

/**
 * THE DEMONSTRATION CONSENT LINKS.
 *
 * A developer, an LTP or a Town Planning Assistant is asked to consent to being
 * named on an application. In production that is a link issued to them and a
 * record kept against the file. Here it is a DEMONSTRATION: the page looks the
 * party up in the same public registers the rest of the portal reads, shows the
 * consent being asked for, and lets the person Accept or Decline.
 *
 * ── What is recorded: nothing ───────────────────────────────────────────
 *
 * BBAS has no model for "consent to an application" — the only consent in
 * the system is the one an LTP or developer gives when they are registered,
 * and it belongs to that registration. So the answer given here is NOT
 * stored: no consent row, no audit row, no message sent. The acknowledgement
 * number is generated for the screen and not kept, and the page says so. A
 * demonstration that wrote such a record would be implying the link had been
 * designed for real (who issues it, how it expires, who may open it), and it
 * has not.
 */

export type ConsentKind = 'DEVELOPER' | 'LTP' | 'TPA';

export type ConsentParty = { name: string; registrationNumber: string | null; description: string; validTo: string | null };
export type ConsentApplication = { applicationNumber: string; permissionType: string; statusLabel: string };

export type ConsentCheck =
  | { ok: true; application: ConsentApplication | null; party: ConsentParty; request: string }
  | { ok: false; reason: string };

const REQUEST: Record<ConsentKind, (party: string, app: string) => string> = {
  DEVELOPER: (party, app) => `${party} is asked to consent to being named as the developer${app}, and to the authority verifying the developer’s registration for the purpose.`,
  LTP: (party, app) => `${party} is asked to consent to acting as the Licensed Technical Person${app}, and to the authority verifying the registration and licence for the purpose.`,
  TPA: (party, app) => `${party} is asked to consent to being named as the scrutinising Town Planning Assistant${app}.`,
};

export async function checkConsent(kind: ConsentKind, input: { partyReference: string; applicationNumber?: string }): Promise<ConsentCheck> {
  let application: ConsentApplication | null = null;
  const appRef = (input.applicationNumber ?? '').trim();
  if (appRef) {
    const found = await getPublicApplicationStatus(appRef);
    if (!found) return { ok: false, reason: 'No application matches that application number.' };
    application = { applicationNumber: found.applicationNumber, permissionType: found.permissionType, statusLabel: found.statusLabel };
  }
  const forApp = application ? ` on application ${application.applicationNumber}` : ' on an application';

  const ref = input.partyReference.trim();
  let party: ConsentParty;

  if (kind === 'DEVELOPER') {
    const d = await getPublicDeveloperStatus(ref);
    if (!d || d.status !== 'APPROVED' || !d.registrationNumber) return { ok: false, reason: 'No developer in force is registered under that number.' };
    party = { name: d.developerName, registrationNumber: d.registrationNumber, description: d.typeLabel, validTo: d.validTo };
  } else if (kind === 'LTP') {
    const l = await getPublicLtp(ref);
    if (!l || l.status !== 'APPROVED' || !l.registrationNumber) return { ok: false, reason: 'No LTP in force is registered under that number.' };
    party = { name: l.name, registrationNumber: l.registrationNumber, description: l.typeLabel, validTo: l.validTo };
  } else {
    // A TPA has no registration number of its own: the public list names them, so the name is the reference.
    if (ref.length < 3) return { ok: false, reason: 'Enter the Town Planning Assistant’s name as it appears on the public list.' };
    const tpa = await prisma.user.findFirst({
      where: { name: { equals: ref, mode: 'insensitive' }, status: 'ACTIVE', deletedAt: null, roles: { some: { role: { key: ROLES.TPA } } }, AND: [{ roles: { none: { role: { key: ROLES.SYSTEM_ADMIN } } } }] },
      select: { name: true, designation: true, primaryZone: { select: { name: true } } },
    });
    if (!tpa) return { ok: false, reason: 'No Town Planning Assistant of that name is on the public list.' };
    party = { name: tpa.name, registrationNumber: null, description: [tpa.designation || 'Town Planning Assistant', tpa.primaryZone?.name].filter(Boolean).join(' · '), validTo: null };
  }

  return { ok: true, application, party, request: REQUEST[kind](party.name, forApp) };
}

/** The screen's acknowledgement. Random, never stored, and labelled as such. */
export const demoAcknowledgement = () => `DEMO-CONSENT-${randomBytes(4).toString('hex').toUpperCase()}`;

/**
 * Registered parties the demonstration can offer as ready-made consent links, so a demo audience
 * does not have to know a registration number to try the page. Real records, read from the registers.
 */
export async function sampleConsentParties(kind: ConsentKind, take = 3): Promise<{ reference: string; label: string }[]> {
  if (kind === 'DEVELOPER') {
    const rows = await prisma.developerRegistration.findMany({
      where: { isCurrent: true, status: 'APPROVED', registrationNumber: { not: null }, validTo: { gte: new Date() } },
      orderBy: { registrationNumber: 'asc' },
      take,
      select: { registrationNumber: true, developerName: true },
    });
    return rows.map((r) => ({ reference: r.registrationNumber ?? '', label: `${r.registrationNumber} — ${r.developerName}` }));
  }
  if (kind === 'LTP') {
    const types = await prisma.masterData.findMany({ where: { category: 'PROFESSIONAL_TYPE', isActive: true }, select: { code: true, metadata: true } });
    const codes = types.filter((t) => Boolean((t.metadata as { canHoldFile?: boolean } | null)?.canHoldFile)).map((t) => t.code);
    const rows = await prisma.professionalRegistration.findMany({
      where: { isCurrent: true, status: 'APPROVED', registrationNumber: { not: null }, validTo: { gte: new Date() }, professionalType: { in: codes } },
      orderBy: { registrationNumber: 'asc' },
      take,
      select: { registrationNumber: true, name: true },
    });
    return rows.map((r) => ({ reference: r.registrationNumber ?? '', label: `${r.registrationNumber} — ${r.name}` }));
  }
  const rows = await prisma.user.findMany({
    where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { key: ROLES.TPA } } }, AND: [{ roles: { none: { role: { key: ROLES.SYSTEM_ADMIN } } } }] },
    orderBy: { name: 'asc' },
    take,
    select: { name: true, primaryZone: { select: { name: true } } },
  });
  return rows.map((r) => ({ reference: r.name, label: `${r.name}${r.primaryZone ? ` — ${r.primaryZone.name}` : ''}` }));
}
