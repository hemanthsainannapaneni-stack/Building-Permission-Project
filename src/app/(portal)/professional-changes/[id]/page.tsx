import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { getProfessionalChange } from '@/server/services/professional-changes';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { ProfessionalChangeDetailView } from '@/features/professional-change/detail';
import type { ProfessionalChangeDetail } from '@/features/professional-change/types';

export const dynamic = 'force-dynamic';

const load = cache(async (user: Parameters<typeof getProfessionalChange>[0], id: string) => {
  try {
    return await getProfessionalChange(user, id);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requirePageCapability(CAPABILITIES.PROFESSIONAL_CHANGE_VIEW);
  const req = await load(user, (await params).id);
  if (!req) notFound();
  return { title: req.requestNumber };
}

export default async function ProfessionalChangePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.PROFESSIONAL_CHANGE_VIEW);
  const req = await load(user, (await params).id);
  if (!req) notFound();
  return (
    <div className="space-y-2">
      <PageHeader
        title={`Change of professional ${req.requestNumber}`}
        description={`${req.application.applicationNumber} · ${req.currentSnapshot.name} → ${req.proposedSnapshot.name}`}
      />
      <ProfessionalChangeDetailView initial={serialize(req) as unknown as ProfessionalChangeDetail} />
    </div>
  );
}
