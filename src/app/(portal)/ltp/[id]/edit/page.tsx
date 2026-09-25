import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { env } from '@/server/config/env';
import { getProfessionalRegistration, professionalTypes } from '@/server/services/professional-registrations';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { ProfessionalForm } from '@/features/professionals/form';
import type { ProfessionalDetailPayload } from '@/features/professionals/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit LTP registration' };

/** Only a DRAFT is edited; anything else goes back to its page. */
export default async function EditProfessionalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.LTP_REG_REGISTER);
  const { id } = await params;
  const data = await getProfessionalRegistration(user, id).catch((error) => {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  });
  if (!data) notFound();
  if (!data.permissions.edit.offered) redirect(`/ltp/${id}`);
  const view = (serialize(data) as unknown as ProfessionalDetailPayload).registration;
  const types = await professionalTypes();
  return (
    <div className="space-y-2">
      <PageHeader title={`Edit ${view.applicationNumber}`} description={view.kind === 'RENEWAL' ? `Renewal of ${view.registrationNumber}.` : 'New registration — draft.'} />
      <ProfessionalForm existing={view} types={types} demoAllowed={env.demoMode} />
    </div>
  );
}
