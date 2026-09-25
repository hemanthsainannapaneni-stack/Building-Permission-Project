import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, Mail, Phone } from 'lucide-react';
import { HELPDESK } from '@/lib/public-content';
import { PageFrame, Panel } from '@/features/public-portal/primitives';

export const metadata: Metadata = { title: 'Helpdesk' };

export default function HelpdeskPage() {
  return (
    <PageFrame title="Helpdesk" intro="How to get help with the portal, and when someone is available. These are demonstration details." demo>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Working hours" description="Demonstration hours" className="lg:col-span-1">
          <p className="mb-3 flex items-center gap-2 text-small text-text-muted"><Clock className="size-4" aria-hidden /> Indian Standard Time</p>
          <table className="w-full text-body">
            <caption className="sr-only">Helpdesk working hours</caption>
            <tbody>
              {HELPDESK.hours.map((h) => (
                <tr key={h.day} className="border-b border-border/70 last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-text">{h.day}</th>
                  <td className="py-2 text-text-muted">{h.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="How to reach the helpdesk" description="Placeholders — no real mailbox or number is behind these" className="lg:col-span-1">
          <ul className="space-y-3 text-body">
            <li className="flex items-center gap-2"><Mail className="size-4 text-primary" aria-hidden /> <a className="text-primary hover:underline" href={`mailto:${HELPDESK.email}`}>{HELPDESK.email}</a></li>
            <li className="flex items-center gap-2"><Phone className="size-4 text-primary" aria-hidden /> <span>{HELPDESK.phone}</span></li>
          </ul>
          <p className="mt-4 text-small text-text-muted">Please quote the application, registration or reference number you are asking about.</p>
        </Panel>

        <Panel title="What we can help with" className="lg:col-span-1">
          <ul className="list-disc space-y-2 pl-5 text-body text-text-muted">
            {HELPDESK.topics.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Try these first">
        <ul className="grid gap-2 text-body sm:grid-cols-2">
          <li><Link className="text-primary hover:underline" href="/public/faq">Frequently asked questions</Link></li>
          <li><Link className="text-primary hover:underline" href="/public/downloads#user-manuals">User manuals</Link></li>
          <li><Link className="text-primary hover:underline" href="/public/status">Search your application status</Link></li>
          <li><Link className="text-primary hover:underline" href="/public/contact">Contact us</Link></li>
        </ul>
      </Panel>
    </PageFrame>
  );
}
