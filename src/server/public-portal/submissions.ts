import 'server-only';
import { prisma } from '@/server/db/prisma';
import { env } from '@/server/config/env';
import { badRequest, businessRule, conflict, notFound } from '@/server/http/errors';
import { CAPABILITIES } from '@/lib/constants';
import {
  DEVELOPER_DOCUMENTS,
  DEVELOPER_DOCUMENT_LABEL,
  isDeveloperDocumentKind,
  missingDeveloperDocuments,
  particularsProblems,
  requiredDeveloperDocuments,
  type DeveloperDocumentKind,
} from '@/lib/developer-registration';
import {
  PROFESSIONAL_DOCUMENT_LABEL,
  REQUIRED_PROFESSIONAL_DOCUMENTS,
  isProfessionalDocumentKind,
  isLapsed,
  professionalProblems,
  type ProfessionalDocumentKind,
} from '@/lib/professional-registration';
import type { DeveloperDraftInput } from '@/lib/schemas/developer-registration';
import type { ProfessionalDraftInput } from '@/lib/schemas/professional-registration';
import {
  createDeveloperDraft,
  renewDeveloperRegistration,
  submitDeveloperRegistration,
  updateDeveloperDraft,
  type DeveloperUploads,
} from '@/server/services/developer-registrations';
import {
  createProfessionalDraft,
  professionalTypes,
  renewProfessionalRegistration,
  submitProfessionalRegistration,
  updateProfessionalDraft,
  type ProfessionalUploads,
} from '@/server/services/professional-registrations';
import { PUBLIC_SESSION_ID, publicApplicant } from './actor';
import { getPublicDeveloperRenewal, getPublicLtpRenewal, ltpTypes } from './registers';
import { payRenewalDemoFee } from './payments';

/**
 * REGISTRATIONS AND RENEWALS FILED FROM THE PUBLIC PORTAL.
 *
 * ── These go through the real services ──────────────────────────────────
 *
 * Nothing here writes a registration row. A public registration is opened and
 * submitted by `createDeveloperDraft` / `submitDeveloperRegistration` (and the
 * professional pair), as the applicant — see `actor.ts` for who that is — so it
 * gets the same numbering, documents pipeline, events, audit rows and
 * notifications as one keyed in at the inward desk, and lands where the
 * inward desk's submissions land: SUBMITTED, waiting for the verifying desk.
 * The internal review is not shortened or skipped.
 *
 * ── Checked BEFORE anything is written ──────────────────────────────────
 *
 * The services split "open a draft" from "submit it". A public applicant has
 * no dashboard to come back to and fix a half-made draft from, so everything
 * the submit step will enforce is checked first, and a refusal writes nothing.
 * The one thing that can still fail between the two steps is infrastructure;
 * a registration then stays a hidden DRAFT (the public pages never show one),
 * and a renewal is resumed by the next attempt rather than blocking it.
 *
 * ── A renewal asks for a second fact ────────────────────────────────────
 *
 * Opening a renewal blocks any other renewal of the same registration, and
 * the registration number is public. Filing one therefore asks for the last
 * four digits of the mobile number on the registration. It is a demonstration
 * control, not authentication — and the department verifies the renewal
 * before it takes effect either way.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };

const FILE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/** Refuses a file the storage pipeline would refuse, before a renewal has been opened around it. */
function precheckFile(field: string, file: { name: string; bytes: Buffer }) {
  if (!FILE_EXTENSIONS.includes(extensionOf(file.name))) throw badRequest('Only PDF, PNG or JPG files are accepted.', [{ path: field, message: 'Only PDF, PNG or JPG files are accepted.' }]);
  if (file.bytes.byteLength === 0) throw badRequest('That file is empty.', [{ path: field, message: 'That file is empty.' }]);
  if (file.bytes.byteLength > MAX_FILE_BYTES) throw badRequest('That file is larger than 10 MB.', [{ path: field, message: 'That file is larger than 10 MB.' }]);
}

const demoKinds = (input: { demoDocuments: boolean; demoKinds: string }) => (input.demoDocuments ? input.demoKinds.split(',').map((k) => k.trim()).filter(Boolean) : []);

const last4 = (mobile: string) => mobile.replace(/\D/g, '').slice(-4);

/** Same message for "no such registration" and "digits do not match": neither confirms a number's mobile. */
const MISMATCH = 'The registration number and mobile digits do not match a registration. Check both and try again.';

export type PublicFiling = {
  applicationNumber: string;
  status: string;
  kind: 'NEW' | 'RENEWAL';
  statusPath: string;
  /** Where the renewal's fee can be paid or its payment status read. Renewals only. */
  paymentPath?: string;
  /** The demonstration fee, when the applicant chose to pay it with the renewal. */
  payment?: { receipt: string; method: string; amount: number } | null;
};

// ═══════════════════════════════════════════════════════════════════════════
// Developers
// ═══════════════════════════════════════════════════════════════════════════

export async function filePublicDeveloperRegistration(input: DeveloperDraftInput, uploads: DeveloperUploads, meta: Meta): Promise<PublicFiling> {
  const problems = particularsProblems(input);
  const details = Object.entries(problems).map(([path, message]) => ({ path, message }));

  const uploaded = Object.keys(uploads).filter(isDeveloperDocumentKind) as DeveloperDocumentKind[];
  for (const kind of uploaded) precheckFile(`doc_${kind}`, uploads[kind]!);
  const placeholders = demoKinds(input).filter(isDeveloperDocumentKind);
  if (placeholders.length && !env.demoMode) throw badRequest('A demo placeholder document can only be used in the demonstration environment.');
  const have = [...uploaded, ...placeholders];
  for (const kind of missingDeveloperDocuments(requiredDeveloperDocuments(input.developerType, input.gstin), have)) {
    details.push({ path: `doc_${kind}`, message: `Attach the ${DEVELOPER_DOCUMENT_LABEL[kind].toLowerCase()}.` });
  }
  if (details.length) throw businessRule('The registration is not complete. Correct the highlighted items and submit again.', details);

  // One live registration per PAN — the same rule the submit step enforces, asked first so a
  // refusal leaves no draft behind.
  const clash = await prisma.developerRegistration.findFirst({
    where: { pan: input.pan, isCurrent: true, status: { notIn: ['DRAFT', 'REJECTED', 'EXPIRED'] } },
    select: { applicationNumber: true, registrationNumber: true },
  });
  if (clash) throw conflict(`A registration for this PAN already exists (${clash.registrationNumber ?? clash.applicationNumber}). Use Developer Renewal instead.`);

  const actor = publicApplicant(input.authorizedPerson || input.developerName, input.email, [CAPABILITIES.DEVELOPER_VIEW, CAPABILITIES.DEVELOPER_REGISTER]);
  const draft = await createDeveloperDraft(actor, { ...input, uploads }, meta);
  const submitted = await submitDeveloperRegistration(actor, draft.id, { remarks: 'Filed online through the public portal.', expectedStatus: 'DRAFT' }, meta);
  return { applicationNumber: submitted.applicationNumber, status: submitted.status, kind: 'NEW', statusPath: `/public/developers/status?ref=${encodeURIComponent(submitted.applicationNumber)}` };
}

export type DeveloperRenewalInput = { registrationNumber: string; mobileLast4: string; remarks: string; demoDocuments: boolean; demoKinds: string; payMethod?: string };

export async function filePublicDeveloperRenewal(input: DeveloperRenewalInput, uploads: DeveloperUploads, meta: Meta): Promise<PublicFiling> {
  const view = await getPublicDeveloperRenewal(input.registrationNumber);
  const row = view ? await prisma.developerRegistration.findUnique({ where: { id: view.registrationId } }) : null;
  if (!view || !row || last4(row.mobile) !== input.mobileLast4.replace(/\D/g, '')) throw notFound(MISMATCH);

  for (const kind of Object.keys(uploads).filter(isDeveloperDocumentKind)) precheckFile(`doc_${kind}`, uploads[kind]!);
  if (demoKinds(input).length && !env.demoMode) throw badRequest('A demo placeholder document can only be used in the demonstration environment.');

  // A renewal this portal opened and could not finish is resumed, not refused.
  const resumable = await prisma.developerRegistration.findFirst({
    where: { lineageId: row.lineageId, kind: 'RENEWAL', status: 'DRAFT', createdById: PUBLIC_SESSION_ID },
    orderBy: { createdAt: 'desc' },
  });
  if (view.blocker && !resumable) throw conflict(view.blocker);

  const actor = publicApplicant(row.authorizedPerson || row.developerName, row.email, [CAPABILITIES.DEVELOPER_VIEW, CAPABILITIES.DEVELOPER_REGISTER]);
  const draft = resumable ?? (await (async () => {
    const opened = await renewDeveloperRegistration(actor, row.id, { remarks: input.remarks || `Renewal of ${row.registrationNumber} filed through the public portal.` }, meta);
    return prisma.developerRegistration.findUniqueOrThrow({ where: { id: opened.id } });
  })());

  const extra = Object.keys(uploads).length > 0 || demoKinds(input).length > 0;
  if (extra) {
    await updateDeveloperDraft(
      actor,
      draft.id,
      {
        developerType: draft.developerType as DeveloperDraftInput['developerType'],
        developerName: draft.developerName,
        organization: draft.organization,
        authorizedPerson: draft.authorizedPerson,
        authorizedDesignation: draft.authorizedDesignation,
        address: draft.address,
        district: draft.district,
        pincode: draft.pincode,
        mobile: draft.mobile,
        email: draft.email,
        pan: draft.pan,
        gstin: draft.gstin,
        incorporationNo: draft.incorporationNo,
        incorporationDate: draft.incorporationDate?.toISOString().slice(0, 10) ?? null,
        reraNo: draft.reraNo,
        experienceYears: draft.experienceYears,
        projectsCompleted: draft.projectsCompleted,
        registrationInfo: draft.registrationInfo,
        demoDocuments: input.demoDocuments,
        demoKinds: input.demoKinds,
        expectedStatus: 'DRAFT',
        uploads,
      },
      meta
    );
  }
  const submitted = await submitDeveloperRegistration(actor, draft.id, { remarks: input.remarks || 'Renewal filed online through the public portal.', expectedStatus: 'DRAFT' }, meta);
  const payment = input.payMethod ? await payRenewalDemoFee({ kind: 'DEVELOPER', renewalNumber: submitted.applicationNumber, mobileLast4: row.mobile, method: input.payMethod }, meta) : null;
  return {
    applicationNumber: submitted.applicationNumber,
    status: submitted.status,
    kind: 'RENEWAL',
    statusPath: `/public/developers/status?ref=${encodeURIComponent(submitted.applicationNumber)}`,
    paymentPath: `/public/developers/renewal?pay=${encodeURIComponent(submitted.applicationNumber)}`,
    payment: payment ? { receipt: payment.receipt, method: payment.method, amount: payment.amount } : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Licensed technical persons
// ═══════════════════════════════════════════════════════════════════════════

export async function filePublicLtpRegistration(input: ProfessionalDraftInput, uploads: ProfessionalUploads, meta: Meta): Promise<PublicFiling> {
  const [types, allowed] = await Promise.all([professionalTypes(), ltpTypes({ activeOnly: true })]);
  if (!allowed.some((t) => t.code === input.professionalType)) {
    throw badRequest('Choose one of the LTP types offered.', [{ path: 'professionalType', message: 'Choose one of the LTP types offered.' }]);
  }
  // A public applicant never links a portal account: the registering desk does that after verification.
  const clean: ProfessionalDraftInput = { ...input, userId: null };

  const problems = professionalProblems(clean, types, new Date());
  const details = Object.entries(problems).map(([path, message]) => ({ path, message }));

  const uploaded = Object.keys(uploads).filter(isProfessionalDocumentKind) as ProfessionalDocumentKind[];
  for (const kind of uploaded) precheckFile(`doc_${kind}`, uploads[kind]!);
  const placeholders = demoKinds(clean).filter(isProfessionalDocumentKind);
  if (placeholders.length && !env.demoMode) throw badRequest('A demo placeholder document can only be used in the demonstration environment.');
  const have = new Set<string>([...uploaded, ...placeholders]);
  for (const kind of REQUIRED_PROFESSIONAL_DOCUMENTS.filter((k) => !have.has(k))) {
    details.push({ path: `doc_${kind}`, message: `Attach the ${PROFESSIONAL_DOCUMENT_LABEL[kind].toLowerCase()}.` });
  }
  if (details.length) throw businessRule('The registration is not complete. Correct the highlighted items and submit again.', details);

  const clash = await prisma.professionalRegistration.findFirst({
    where: { professionalType: clean.professionalType, isCurrent: true, status: { notIn: ['DRAFT', 'REJECTED', 'EXPIRED'] }, licenceNo: { equals: clean.licenceNo, mode: 'insensitive' } },
    select: { applicationNumber: true, registrationNumber: true },
  });
  if (clash) throw conflict(`This licence is already registered (${clash.registrationNumber ?? clash.applicationNumber}). Use LTP Renewal instead.`);

  const actor = publicApplicant(clean.name, clean.email, [CAPABILITIES.LTP_REG_VIEW, CAPABILITIES.LTP_REG_REGISTER]);
  const draft = await createProfessionalDraft(actor, { ...clean, uploads }, meta);
  const submitted = await submitProfessionalRegistration(actor, draft.id, { remarks: 'Filed online through the public portal.', expectedStatus: 'DRAFT' }, meta);
  return { applicationNumber: submitted.applicationNumber, status: submitted.status, kind: 'NEW', statusPath: `/public/ltp/view?reg=${encodeURIComponent(submitted.applicationNumber)}` };
}

export type LtpRenewalInput = {
  registrationNumber: string;
  mobileLast4: string;
  /** The licence's renewed validity, YYYY-MM-DD. */
  licenceValidTo: string;
  consentGiven: boolean;
  remarks: string;
  demoDocuments: boolean;
  demoKinds: string;
  payMethod?: string;
};

export async function filePublicLtpRenewal(input: LtpRenewalInput, uploads: ProfessionalUploads, meta: Meta): Promise<PublicFiling> {
  const view = await getPublicLtpRenewal(input.registrationNumber);
  const row = view ? await prisma.professionalRegistration.findUnique({ where: { id: view.registrationId } }) : null;
  if (!view || !row || last4(row.mobile) !== input.mobileLast4.replace(/\D/g, '')) throw notFound(MISMATCH);

  const details: { path: string; message: string }[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.licenceValidTo) || Number.isNaN(new Date(input.licenceValidTo).getTime())) details.push({ path: 'licenceValidTo', message: 'Enter the date the licence is now valid to.' });
  else if (isLapsed(input.licenceValidTo, new Date())) details.push({ path: 'licenceValidTo', message: 'The licence has lapsed. It must be renewed with the registration body first.' });
  if (!input.consentGiven) details.push({ path: 'consentGiven', message: 'The LTP’s consent is required.' });
  if (details.length) throw businessRule('The renewal is not complete. Correct the highlighted items and submit again.', details);

  for (const kind of Object.keys(uploads).filter(isProfessionalDocumentKind)) precheckFile(`doc_${kind}`, uploads[kind]!);
  if (demoKinds(input).length && !env.demoMode) throw badRequest('A demo placeholder document can only be used in the demonstration environment.');

  const resumable = await prisma.professionalRegistration.findFirst({
    where: { lineageId: row.lineageId, kind: 'RENEWAL', status: 'DRAFT', createdById: PUBLIC_SESSION_ID },
    orderBy: { createdAt: 'desc' },
  });
  if (view.blocker && !resumable) throw conflict(view.blocker);

  const actor = publicApplicant(row.name, row.email, [CAPABILITIES.LTP_REG_VIEW, CAPABILITIES.LTP_REG_REGISTER]);
  const draft =
    resumable ??
    (await (async () => {
      const opened = await renewProfessionalRegistration(actor, row.id, { remarks: input.remarks || `Renewal of ${row.registrationNumber} filed through the public portal.`, licenceValidTo: input.licenceValidTo }, meta);
      return prisma.professionalRegistration.findUniqueOrThrow({ where: { id: opened.id } });
    })());

  // The renewal draft carries the particulars forward; what it lacks is the consent (given afresh)
  // and any supporting document the applicant adds.
  await updateProfessionalDraft(
    actor,
    draft.id,
    {
      professionalType: draft.professionalType,
      name: draft.name,
      userId: draft.userId,
      licenceNo: draft.licenceNo,
      registrationBody: draft.registrationBody,
      qualification: draft.qualification,
      experienceYears: draft.experienceYears,
      organization: draft.organization,
      address: draft.address,
      district: draft.district,
      pincode: draft.pincode,
      mobile: draft.mobile,
      email: draft.email,
      licenceValidFrom: draft.licenceValidFrom?.toISOString().slice(0, 10) ?? null,
      licenceValidTo: input.licenceValidTo,
      consentGiven: true,
      demoDocuments: input.demoDocuments,
      demoKinds: input.demoKinds,
      expectedStatus: 'DRAFT',
      uploads,
    },
    meta
  );
  const submitted = await submitProfessionalRegistration(actor, draft.id, { remarks: input.remarks || 'Renewal filed online through the public portal.', expectedStatus: 'DRAFT' }, meta);
  const payment = input.payMethod ? await payRenewalDemoFee({ kind: 'LTP', renewalNumber: submitted.applicationNumber, mobileLast4: row.mobile, method: input.payMethod }, meta) : null;
  return {
    applicationNumber: submitted.applicationNumber,
    status: submitted.status,
    kind: 'RENEWAL',
    statusPath: `/public/ltp/view?reg=${encodeURIComponent(row.registrationNumber ?? '')}`,
    paymentPath: `/public/ltp/payment-renewal?ref=${encodeURIComponent(submitted.applicationNumber)}`,
    payment: payment ? { receipt: payment.receipt, method: payment.method, amount: payment.amount } : null,
  };
}

export { DEVELOPER_DOCUMENTS };
