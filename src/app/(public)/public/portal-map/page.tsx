import type { Metadata } from 'next';
import Link from 'next/link';
import { PORTAL_MAP_SECTIONS } from '@/lib/public-portal';
import { PageFrame, Panel } from '@/features/public-portal/primitives';

export const metadata: Metadata = { title: 'Portal Map' };

/** Every public destination, grouped as the home page groups them. Generated from the same catalogue the links use. */
export default function PortalMapPage() {
  return (
    <PageFrame title="Portal Map" intro="Every public service and information page on one screen. Each item opens its own page." crumbs={[]}>
      <div className="grid gap-6 md:grid-cols-2">
        {PORTAL_MAP_SECTIONS.map((section) => (
          <Panel
            key={section.key}
            id={`map-${section.key}`}
            title={section.title}
            description={section.blurb}
            actions={
              section.href ? (
                <Link href={section.href} className="text-small font-medium text-primary hover:underline">
                  Overview →
                </Link>
              ) : undefined
            }
          >
            <ul className="divide-y divide-border/70">
              {section.links.map((link) => (
                <li key={link.key} className="py-2.5 first:pt-0 last:pb-0">
                  <Link href={link.href} className="font-medium text-primary hover:underline">
                    {link.label}
                  </Link>
                  <p className="text-small text-text-muted">{link.summary}</p>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </PageFrame>
  );
}
