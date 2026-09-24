import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { getApplicationOccupancy } from '@/server/services/occupancy';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { OccupancyPanel } from '@/features/occupancy/panel';
import type { ApplicationOccupancyPayload } from '@/features/occupancy/types';

export const dynamic = 'force-dynamic';

/** Keyed by APPLICATION id: a file at "completion pending" has no occupancy row yet. */
const load = cache(async (user: Parameters<typeof getApplicationOccupancy>[0], id: string) => {
  try {
    return await getApplicationOccupancy(user, id);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requirePageCapability(CAPABILITIES.OCCUPANCY_VIEW);
  const data = await load(user, (await params).id);
  if (!data) notFound();
  return { title: data.occupancy?.occupancyNumber ?? `Occupancy — ${data.application.applicationNumber}` };
}

export default async function OccupancyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.OCCUPANCY_VIEW);
  const data = await load(user, (await params).id);
  if (!data) notFound();
  return (
    <div className="space-y-2">
      <PageHeader
        title={data.occupancy ? `Occupancy ${data.occupancy.occupancyNumber}` : `Occupancy — ${data.application.applicationNumber}`}
        description={[data.application.applicationNumber, data.order?.orderNumber, data.owner].filter(Boolean).join(' · ')}
      />
      <OccupancyPanel initial={serialize(data) as unknown as ApplicationOccupancyPayload} showApplicationLink />
    </div>
  );
}
