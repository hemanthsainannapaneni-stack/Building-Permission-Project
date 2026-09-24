import type { Metadata } from 'next';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { listChecklistItems, checklistSummary } from '@/server/services/checklist-admin';
import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChecklistPanel, type ChecklistRow } from '@/features/admin/checklist-panel';

export const metadata: Metadata = { title: 'Checklists — configuration' };
export const dynamic = 'force-dynamic';

/**
 * The 19-point application checklist and the 27-point site inspection
 * checklist, as configuration.
 *
 * The screen exists because the official wording is not available: the BBAS
 * manuals describe both checklists and show them in screenshots, but neither
 * reproduces the questions as text. The rows carry provisional sentences
 * written from the subject areas the manuals do name, marked as provisional
 * everywhere they appear, and replacing them is typing — not a migration and
 * not a deployment. That is the whole point of storing them.
 */
export default async function ChecklistConfigurationPage() {
  await requirePageCapability(CAPABILITIES.MASTER_DATA_MANAGE);

  const [items, summary] = await Promise.all([listChecklistItems(), checklistSummary()]);

  const application = items.filter((i) => i.kind === 'APPLICATION') as ChecklistRow[];
  const inspection = items.filter((i) => i.kind === 'SITE_INSPECTION') as ChecklistRow[];

  const provisional =
    (summary.APPLICATION?.provisional ?? 0) + (summary.SITE_INSPECTION?.provisional ?? 0);

  return (
    <>
      <PageHeader
        title="Checklists"
        description={
          `${application.length} application questions and ${inspection.length} site inspection questions. ` +
          (provisional
            ? `${provisional} still carry provisional wording.`
            : 'All questions carry official wording.')
        }
      />

      <Tabs defaultValue="application">
        <TabsList>
          <TabsTrigger value="application">
            Application checklist ({application.length})
          </TabsTrigger>
          <TabsTrigger value="inspection">
            Site inspection ({inspection.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="application" className="pt-4">
          <ChecklistPanel items={application} />
        </TabsContent>

        <TabsContent value="inspection" className="pt-4">
          <ChecklistPanel items={inspection} />
        </TabsContent>
      </Tabs>
    </>
  );
}
