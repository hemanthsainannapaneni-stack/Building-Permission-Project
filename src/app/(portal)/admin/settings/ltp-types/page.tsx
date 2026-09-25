import type { Metadata } from 'next';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { listProfessionalTypesForAdmin } from '@/server/services/professional-registrations';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { ProfessionalTypesPanel } from '@/features/professionals/types-panel';
import type { ProfessionalTypeAdminRow } from '@/features/professionals/types';

export const metadata: Metadata = { title: 'LTP Types — configuration' };
export const dynamic = 'force-dynamic';

/** The professional types the register accepts. Configuration, not code. */
export default async function ProfessionalTypesPage() {
  const user = await requirePageCapability(CAPABILITIES.MASTER_DATA_MANAGE);
  const types = await listProfessionalTypesForAdmin(user);
  return (
    <>
      <PageHeader
        title="LTP Types"
        description={`${types.filter((t) => t.isActive).length} of ${types.length} registered. "Holds files" types may be an application's LTP or take one over; "structural" types may be named as a file's structural engineer.`}
      />
      <ProfessionalTypesPanel initial={serialize(types) as unknown as ProfessionalTypeAdminRow[]} />
    </>
  );
}
