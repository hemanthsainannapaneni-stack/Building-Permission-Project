import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { getProfessionalRegistration } from '@/server/services/professional-registrations';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { ProfessionalPanel } from '@/features/professionals/panel';
import type { ProfessionalDetailPayload } from '@/features/professionals/types';

export const dynamic = 'force-dynamic';

const load = cache(async (user: Parameters<typeof getProfessionalRegistration>[0], id: string) => {
  try {
    return await getProfessionalRegistration(user, id);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requirePageCapability(CAPABILITIES.LTP_REG_VIEW);
  const data = await load(user, (await params).id);
  if (!data) notFound();
  return { title: data.registration.registrationNumber ?? data.registration.applicationNumber };
}

export default async function ProfessionalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.LTP_REG_VIEW);
  const data = await load(user, (await params).id);
  if (!data) notFound();
  const r = data.registration;
  return (
    <div className="space-y-2">
      <PageHeader
        title={r.registrationNumber ? `${r.typeLabel} ${r.registrationNumber}` : `LTP registration ${r.applicationNumber}`}
        description={[r.applicationNumber, r.name, r.organization].filter(Boolean).join(' · ')}
      />
      <ProfessionalPanel initial={serialize(data) as unknown as ProfessionalDetailPayload} />
    </div>
  );
}
