import type { Metadata } from 'next';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { listWorkflows } from '@/server/services/workflow-admin';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Share2 } from 'lucide-react';

export const metadata: Metadata = { title: 'Workflow Configuration' };
export const dynamic = 'force-dynamic';

export default async function WorkflowConfigurationPage() {
  await requirePageCapability(CAPABILITIES.SETTINGS_MANAGE);
  const workflows = await listWorkflows();

  return (
    <>
      <PageHeader
        title="Workflow Configuration"
        description="The active workflow processes and their configured stages. This is a read-only view of the current state."
      />
      <div className="grid gap-6">
        {workflows.map((wf) => (
          <Card key={wf.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Share2 className="size-4 text-text-muted" />
                    {wf.name}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Code: {wf.code} · Version: {wf.version}
                  </CardDescription>
                </div>
                <Badge tone={wf.isPublished ? 'success' : 'neutral'}>
                  {wf.isPublished ? 'Published' : 'Draft'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {wf.description && <p className="text-small text-text-muted">{wf.description}</p>}
                
                <div>
                  <h4 className="mb-2 text-small font-semibold text-text">Stages ({wf.stages.length})</h4>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {wf.stages.map((stage) => (
                      <div key={stage.id} className="rounded border border-border bg-surface-sunk p-3">
                        <div className="flex items-start justify-between">
                          <p className="font-medium text-body">{stage.name}</p>
                          <Badge tone="outline" className="text-[10px]">{stage.type}</Badge>
                        </div>
                        <p className="mt-1 text-caption text-text-muted">Code: {stage.code}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2">
                  <h4 className="mb-2 text-small font-semibold text-text">Transitions ({wf.transitions.length})</h4>
                  <p className="text-small text-text-muted">Transitions and guards are managed via configuration files to prevent invalid graphs.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
