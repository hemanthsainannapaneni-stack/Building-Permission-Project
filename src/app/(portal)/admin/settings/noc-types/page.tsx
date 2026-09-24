import type { Metadata } from 'next';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { listNocTypes } from '@/server/services/nocs';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { NocTypesPanel, type NocTypeRow } from '@/features/nocs/noc-types-panel';

export const metadata: Metadata = { title: 'NOC Types — configuration' };
export const dynamic = 'force-dynamic';

/**
 * The NOC catalogue. Switching a kind on makes it available to open on a
 * file; nothing else changes. No legal threshold is configured here — whether
 * a file needs a NOC is the reviewing desk's determination on that file.
 */
export default async function NocTypesPage() {
  const user = await requirePageCapability(CAPABILITIES.MASTER_DATA_MANAGE);
  const types = await listNocTypes(user);

  return (
    <>
      <PageHeader
        title="NOC Types"
        description={`${types.filter((t) => t.isActive).length} of ${types.length} in use. Applicability is decided per file by the reviewing desk — no thresholds are configured.`}
      />
      <NocTypesPanel initial={serialize(types) as unknown as NocTypeRow[]} />
    </>
  );
}
