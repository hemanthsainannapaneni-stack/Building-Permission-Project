import type { Metadata } from 'next';
import { PageFrame, Panel } from '@/features/public-portal/primitives';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <PageFrame title="Privacy" intro="What the public pages read, what they never show, and what a form you submit does. A demonstration statement, not a legal one." demo>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="What the public pages show">
          <ul className="list-disc space-y-2 pl-5 text-body text-text-muted">
            <li>An application’s number, permission type, dates, public status, stage, payment status and issued order.</li>
            <li>The applicant’s name only in masked form, unless you also give the applicant’s mobile number.</li>
            <li>Registers of developers, LTPs and Town Planning Assistants: number, name, type, status and validity.</li>
            <li>Counts on the dashboard. Never a row.</li>
          </ul>
        </Panel>
        <Panel title="What they never show">
          <ul className="list-disc space-y-2 pl-5 text-body text-text-muted">
            <li>Officers’ remarks, internal notes, audit records, task queues or workflow details.</li>
            <li>Documents, drawings or models.</li>
            <li>Addresses, phone numbers, email addresses, PAN or GST numbers of anyone.</li>
            <li>Gateway transaction references or bank details.</li>
          </ul>
        </Panel>
        <Panel title="Forms you submit">
          <p className="text-body text-text-muted">A registration or renewal you file is created in the same system the authority’s staff use and is reviewed by them. Files you attach are stored privately and are never served back to the public. Every request is rate limited by address. Because this is a demonstration, use fictional details.</p>
        </Panel>
        <Panel title="Demonstration payments and consent">
          <p className="text-body text-text-muted">No real payment is processed, and the consent pages store nothing. Both say so where they are used.</p>
        </Panel>
      </div>
    </PageFrame>
  );
}
