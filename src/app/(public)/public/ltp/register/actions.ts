'use server';

import { publicApplicant } from '@/server/public-portal/actor';
import { CAPABILITIES, ROLES } from '@/lib/constants';
import { createProfessionalDraft, submitProfessionalRegistration } from '@/server/services/professional-registrations';
import { createUser } from '@/server/services/users';
import { isApiError } from '@/server/http/errors';
import { prisma } from '@/server/db/prisma';

export async function submitLtpRegistrationAction(
  formData: FormData,
  uploads: Record<string, { name: string; type: string; bytes: Buffer }>
) {
  const actor = publicApplicant('Demo Applicant', 'demo@example.com', [
    CAPABILITIES.LTP_REG_REGISTER,
    CAPABILITIES.LTP_REG_VIEW // Added to pass requireView check
  ]);
  const meta = { ip: '127.0.0.1', userAgent: 'public-portal' };

  try {
    const rawData = Object.fromEntries(formData.entries());
    
    // We collect login info
    const email = String(rawData.email || '').trim();
    const name = String(rawData.name || '').trim();
    const mobile = String(rawData.mobile || '').trim();
    const password = String(rawData.password || '');
    
    let userId: string | null = null;
    
    if (password && email) {
      // Check if user exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const userRes = await createUser(
          {
            email,
            name,
            phone: mobile,
            roleKey: ROLES.LTP,
            password,
            designation: 'LTP Applicant',
            employeeCode: '',
            zoneIds: [],
            ltpLicenceNo: String(rawData.licenceNo || ''),
            ltpLicenceClass: '',
            firmName: String(rawData.organization || ''),
          },
          actor,
          meta
        );
        userId = userRes.user.id;
      }
    }

    const draftInput = {
      professionalType: String(rawData.professionalType || ''),
      name,
      userId,
      licenceNo: String(rawData.licenceNo || ''),
      registrationBody: String(rawData.registrationBody || 'APCRDA'),
      qualification: String(rawData.qualification || ''),
      experienceYears: rawData.experienceYears ? Number(rawData.experienceYears) : 0,
      organization: String(rawData.organization || ''),
      address: String(rawData.address || ''),
      district: String(rawData.district || ''),
      pincode: String(rawData.pincode || ''),
      mobile,
      email,
      licenceValidFrom: new Date().toISOString(),
      licenceValidTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      consentGiven: rawData.consentGiven === 'true' || rawData.consentGiven === 'on',
      demoDocuments: true,
      demoKinds: 'LICENCE_CERTIFICATE,QUALIFICATION_CERTIFICATE,ID_PROOF,ADDRESS_PROOF,CONSENT_LETTER',
    };

    const draft = await createProfessionalDraft(actor, { ...draftInput, uploads }, meta);
    
    const submitted = await submitProfessionalRegistration(actor, draft.id, { remarks: 'Submitted via public portal' }, meta);
    
    return { success: true, applicationNumber: submitted.applicationNumber, id: submitted.id };
  } catch (error) {
    if (isApiError(error)) {
      return { success: false, message: error.message, details: error.details };
    }
    console.error('[ltp-registration]', error);
    return { success: false, message: 'An unexpected error occurred. Please try again.' };
  }
}
