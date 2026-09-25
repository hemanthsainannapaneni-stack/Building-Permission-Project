import type { Metadata } from 'next';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { env } from '@/server/config/env';
import { PageHeader } from '@/components/common/page-header';
import { DeveloperForm } from '@/features/developers/form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New developer registration' };

export default async function NewDeveloperPage() {
  await requirePageCapability(CAPABILITIES.DEVELOPER_REGISTER);
  return (
    <div className="space-y-2">
      <PageHeader
        title="New developer registration"
        description="Key in the developer’s application as received. It is saved as a draft with its own reference; submit it once the particulars and documents are complete."
      />
      <DeveloperForm demoAllowed={env.demoMode} />
    </div>
  );
}
