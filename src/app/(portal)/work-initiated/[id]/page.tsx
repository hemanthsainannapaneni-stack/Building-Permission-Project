import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { getApplicationCommencement } from '@/server/services/work-commencements';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { CommencementPanel } from '@/features/commencement/panel';
import type { ApplicationCommencementPayload } from '@/features/commencement/types';

export const dynamic = 'force-dynamic';

/** Keyed by APPLICATION id: a file whose proceeding is issued has no notice row yet. */
const load = cache(async (user: Parameters<typeof getApplicationCommencement>[0], id: string) => {
  try {
    return await getApplicationCommencement(user, id);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requirePageCapability(CAPABILITIES.COMMENCEMENT_VIEW);
  const data = await load(user, (await params).id);
  if (!data) notFound();
  return { title: `Work Initiated — ${data.application.applicationNumber}` };
}

export default async function WorkInitiatedDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.COMMENCEMENT_VIEW);
  const data = await load(user, (await params).id);
  if (!data) notFound();
  return (
    <div className="space-y-2">
      <PageHeader
        title={`Work Initiated — ${data.application.applicationNumber}`}
        description={[data.order?.orderNumber, data.owner, data.commencement?.contractor.name].filter(Boolean).join(' · ')}
      />
      <CommencementPanel initial={serialize(data) as unknown as ApplicationCommencementPayload} showApplicationLink />
    </div>
  );
}
