import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { getInspection } from '@/server/services/site-inspections';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { InspectionDetailView } from '@/features/inspections/inspection-detail';
import type { InspectionDetail } from '@/features/inspections/types';

export const dynamic = 'force-dynamic';

const load = cache(async (user: Parameters<typeof getInspection>[0], id: string) => {
  try {
    return await getInspection(user, id);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
});

/** The 404 is decided here, before the head is flushed — see the application page. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requirePageCapability(CAPABILITIES.SITE_INSPECTION_VIEW);
  const { id } = await params;
  const inspection = await load(user, id);
  if (!inspection) notFound();
  return { title: inspection.inspectionNumber };
}

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.SITE_INSPECTION_VIEW);
  const { id } = await params;
  const inspection = await load(user, id);
  if (!inspection) notFound();

  return (
    <div className="space-y-2">
      <PageHeader
        title={`Site inspection ${inspection.inspectionNumber}`}
        description={`${inspection.application.applicationNumber} · ${inspection.application.owner || 'Owner not recorded'}`}
      />
      <InspectionDetailView initial={serialize(inspection) as unknown as InspectionDetail} />
    </div>
  );
}
