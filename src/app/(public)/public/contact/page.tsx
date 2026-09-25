import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, Mail, Phone } from 'lucide-react';
import { CONTACT } from '@/lib/public-content';
import { PageFrame, Panel } from '@/features/public-portal/primitives';

export const metadata: Metadata = { title: 'Contact Us' };

export default function ContactPage() {
  return (
    <PageFrame title="Contact Us" intro="Demonstration contact details. No official contact details were supplied to this project, and none is invented here." demo>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={CONTACT.organisation}>
          <ul className="space-y-4 text-body">
            <li className="flex gap-3">
              <Building2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <address className="not-italic text-text-muted">
                {CONTACT.address.map((line) => (
                  <span key={line} className="block">{line}</span>
                ))}
              </address>
            </li>
            <li className="flex items-center gap-3"><Mail className="size-4 shrink-0 text-primary" aria-hidden /> <a className="text-primary hover:underline" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
            <li className="flex items-center gap-3"><Phone className="size-4 shrink-0 text-primary" aria-hidden /> <span>{CONTACT.phone}</span></li>
          </ul>
        </Panel>

        <Panel title="Where to go for what">
          <ul className="space-y-2 text-body">
            <li>Help using the portal — <Link className="text-primary hover:underline" href="/public/helpdesk">Helpdesk</Link></li>
            <li>Common questions — <Link className="text-primary hover:underline" href="/public/faq">FAQ</Link></li>
            <li>A file’s status or fees — <Link className="text-primary hover:underline" href="/public/status">Application status</Link> · <Link className="text-primary hover:underline" href="/public/pay-fees">Pay fees</Link></li>
            <li>Every public page — <Link className="text-primary hover:underline" href="/public/portal-map">Portal map</Link></li>
          </ul>
        </Panel>
      </div>
    </PageFrame>
  );
}
