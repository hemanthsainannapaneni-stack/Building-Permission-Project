import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { getRevocation } from '@/server/services/revocations';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { RevocationDetailView } from '@/features/proceedings/revocation-detail';
import type { RevocationDetail } from '@/features/proceedings/types';

export const dynamic = 'force-dynamic';

const load = cache(async (user: Parameters<typeof getRevocation>[0], id: string) => {
  try {
    return await getRevocation(user, id);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requirePageCapability(CAPABILITIES.REVOCATION_VIEW);
  const rev = await load(user, (await params).id);
  if (!rev) notFound();
  return { title: rev.revocationNumber };
}

export default async function RevocationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.REVOCATION_VIEW);
  const rev = await load(user, (await params).id);
  if (!rev) notFound();
  return (
    <div className="space-y-2">
      <PageHeader title={`Revocation ${rev.revocationNumber}`} description={`${rev.application.applicationNumber} · BPO ${rev.orderNumber || '—'}`} />
      <RevocationDetailView initial={serialize(rev) as unknown as RevocationDetail} />
    </div>
  );
}
