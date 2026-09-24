import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { getOutward } from '@/server/services/outward';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { OutwardDetailView } from '@/features/proceedings/outward-detail';
import type { OutwardDetail } from '@/features/proceedings/types';

export const dynamic = 'force-dynamic';

const load = cache(async (user: Parameters<typeof getOutward>[0], id: string) => {
  try {
    return await getOutward(user, id);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requirePageCapability(CAPABILITIES.OUTWARD_VIEW);
  const row = await load(user, (await params).id);
  if (!row) notFound();
  return { title: row.outwardNumber };
}

export default async function OutwardEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.OUTWARD_VIEW);
  const row = await load(user, (await params).id);
  if (!row) notFound();
  return (
    <div className="space-y-2">
      <PageHeader title={`Outward ${row.outwardNumber}`} description={`${row.documentReference || row.documentType} · to ${row.recipient}`} />
      <OutwardDetailView initial={serialize(row) as unknown as OutwardDetail} />
    </div>
  );
}
