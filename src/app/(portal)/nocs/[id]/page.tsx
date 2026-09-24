import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { getNoc } from '@/server/services/nocs';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { NocDetailView } from '@/features/nocs/noc-detail';
import type { NocDetail } from '@/features/nocs/types';

export const dynamic = 'force-dynamic';

const load = cache(async (user: Parameters<typeof getNoc>[0], id: string) => {
  try {
    return await getNoc(user, id);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requirePageCapability(CAPABILITIES.NOC_VIEW);
  const { id } = await params;
  const noc = await load(user, id);
  if (!noc) notFound();
  return { title: noc.nocNumber };
}

export default async function NocPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.NOC_VIEW);
  const { id } = await params;
  const noc = await load(user, id);
  if (!noc) notFound();

  return (
    <div className="space-y-2">
      <PageHeader title={`${noc.nocType.name} ${noc.nocNumber}`} description={`${noc.application.applicationNumber} · ${noc.authority || 'Authority not recorded'}`} />
      <NocDetailView initial={serialize(noc) as unknown as NocDetail} />
    </div>
  );
}
