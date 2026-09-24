import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { getShowCause } from '@/server/services/show-cause';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { ShowCauseDetailView } from '@/features/proceedings/show-cause-detail';
import type { ShowCauseDetail } from '@/features/proceedings/types';

export const dynamic = 'force-dynamic';

const load = cache(async (user: Parameters<typeof getShowCause>[0], id: string) => {
  try {
    return await getShowCause(user, id);
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requirePageCapability(CAPABILITIES.SHOW_CAUSE_VIEW);
  const sc = await load(user, (await params).id);
  if (!sc) notFound();
  return { title: sc.noticeNumber };
}

export default async function ShowCauseNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.SHOW_CAUSE_VIEW);
  const sc = await load(user, (await params).id);
  if (!sc) notFound();
  return (
    <div className="space-y-2">
      <PageHeader title={`Show cause ${sc.noticeNumber}`} description={`${sc.application.applicationNumber} · ${sc.application.owner || 'Owner not recorded'}`} />
      <ShowCauseDetailView initial={serialize(sc) as unknown as ShowCauseDetail} />
    </div>
  );
}
