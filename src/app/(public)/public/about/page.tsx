import type { Metadata } from 'next';
import Link from 'next/link';
import { BBAS_INTRO, BIM_INTRO } from '@/lib/public-content';
import { Facts, PageFrame, Panel } from '@/features/public-portal/primitives';

export const metadata: Metadata = { title: 'About Us' };

export default function AboutPage() {
  return (
    <PageFrame title="About Us" intro="Nirman is a BBAS-style building permission demonstration. This is what it is, who it is for, and what it is not." crumbs={[]} demo>
      <Panel title="About Nirman">
        <div className="max-w-3xl space-y-3 text-body text-text-muted">
          <p>Nirman is a working demonstration of an online building permission system: applications prepared by Licensed Technical Persons, scrutiny of drawings and BIM models, fee demands and payments, department review through named desks, permission orders, and the registers of developers, LTPs and Town Planning Assistants.</p>
          <p>It is modelled on the structure of the BBAS building approval system so that the whole journey can be shown end to end. It is <strong className="text-text">not</strong> the official APCRDA BBAS portal, it carries no government seal, and every person, organisation, number and announcement in it is fictional.</p>
        </div>
      </Panel>

      <Panel title="Who uses the public portal">
        <Facts
          columns={2}
          items={[
            { label: 'Citizens', value: 'Follow a file and its fees without signing in.' },
            { label: 'Developers', value: 'Register, renew, and be listed on the public register.' },
            { label: 'Licensed Technical Persons', value: 'Register, renew, and be found by applicants.' },
            { label: 'Town Planning Assistants', value: 'Listed by zone; consent links for applications.' },
          ]}
        />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={BIM_INTRO.title} description={BIM_INTRO.subtitle}>
          <div className="space-y-3 text-body text-text-muted">
            {BIM_INTRO.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </Panel>
        <Panel title={BBAS_INTRO.title} description={BBAS_INTRO.subtitle}>
          <div className="space-y-3 text-body text-text-muted">
            {BBAS_INTRO.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Where to go next">
        <ul className="grid gap-2 text-body sm:grid-cols-2">
          <li><Link className="text-primary hover:underline" href="/public/status">Search your application status</Link></li>
          <li><Link className="text-primary hover:underline" href="/public/developers/register">Register as a developer</Link></li>
          <li><Link className="text-primary hover:underline" href="/public/ltp/register">Register as an LTP</Link></li>
          <li><Link className="text-primary hover:underline" href="/public/portal-map">Portal map</Link></li>
          <li><Link className="text-primary hover:underline" href="/public/faq">Frequently asked questions</Link></li>
          <li><Link className="text-primary hover:underline" href="/public/contact">Contact</Link></li>
        </ul>
      </Panel>
    </PageFrame>
  );
}
