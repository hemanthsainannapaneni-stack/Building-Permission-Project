import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EXPLORE_ITEMS } from '@/lib/public-content';
import { fmtDay } from '@/features/public-portal/format';
import { DemoBanner, PageFrame } from '@/features/public-portal/primitives';

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return EXPLORE_ITEMS.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const item = EXPLORE_ITEMS.find((i) => i.slug === slug);
  return { title: item?.headline ?? 'Announcement' };
}

export default async function ExploreItemPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const item = EXPLORE_ITEMS.find((i) => i.slug === slug);
  if (!item) notFound();

  return (
    <PageFrame title={item.headline} crumbs={[{ label: 'Explore', href: '/#explore' }]} back={{ label: 'Explore', href: '/#explore' }}>
      <DemoBanner>This is a fictional announcement written for the demonstration. It is not official news.</DemoBanner>
      <article className="max-w-3xl space-y-4 rounded-xl border border-border bg-surface p-6 shadow-card">
        <p className="text-small text-text-muted">
          <time dateTime={item.date}>{fmtDay(item.date)}</time>
        </p>
        <p className="text-lg font-medium text-text">{item.summary}</p>
        {item.body.map((p) => (
          <p key={p} className="text-body text-text-muted">{p}</p>
        ))}
        <p>
          <Link href="/public/portal-map" className="font-medium text-primary hover:underline">See every public service →</Link>
        </p>
      </article>
    </PageFrame>
  );
}
