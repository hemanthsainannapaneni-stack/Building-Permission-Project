import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { env } from '@/server/config/env';
import { getDeveloperRegistration } from '@/server/services/developer-registrations';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { DeveloperForm } from '@/features/developers/form';
import type { DeveloperDetailPayload } from '@/features/developers/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit developer registration' };

/** Only a DRAFT is edited; anything else goes back to its page. */
export default async function EditDeveloperPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.DEVELOPER_REGISTER);
  const { id } = await params;
  const data = await getDeveloperRegistration(user, id).catch((error) => {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  });
  if (!data) notFound();
  if (!data.permissions.edit.offered) redirect(`/developers/${id}`);
  const view = (serialize(data) as unknown as DeveloperDetailPayload).registration;
  return (
    <div className="space-y-2">
      <PageHeader title={`Edit ${view.applicationNumber}`} description={view.kind === 'RENEWAL' ? `Renewal of ${view.registrationNumber}.` : 'New registration — draft.'} />
      <DeveloperForm existing={view} demoAllowed={env.demoMode} />
    </div>
  );
}
