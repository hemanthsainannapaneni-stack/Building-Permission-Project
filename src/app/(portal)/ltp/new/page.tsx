import type { Metadata } from 'next';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { env } from '@/server/config/env';
import { professionalTypes } from '@/server/services/professional-registrations';
import { PageHeader } from '@/components/common/page-header';
import { ProfessionalForm } from '@/features/professionals/form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New LTP registration' };

export default async function NewProfessionalPage() {
  await requirePageCapability(CAPABILITIES.LTP_REG_REGISTER);
  const types = await professionalTypes();
  return (
    <div className="space-y-2">
      <PageHeader
        title="New LTP registration"
        description="Key in the LTP’s application as received. It is saved as a draft with its own reference; submit it once the particulars, documents and consent are complete."
      />
      <ProfessionalForm types={types} demoAllowed={env.demoMode} />
    </div>
  );
}
