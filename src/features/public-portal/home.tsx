import Link from 'next/link';
import { ArrowRight, Building2, CalendarDays, ClipboardCheck, FileSearch, HardHat, Layers, Ruler, ShieldCheck, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BBAS_INTRO, BIM_INTRO, EXPLORE_ITEMS, HIGHLIGHT_ITEMS } from '@/lib/public-content';
import { SERVICE_SECTIONS, type PortalSection } from '@/lib/public-portal';
import { cn } from '@/lib/utils';
import { fmtDay } from './format';
import { Container } from './primitives';

/**
 * The home page's sections, in the order the reference portal composes them:
 * the three service cards (the main action area), then What is BIM?, What is
 * BBAS?, Explore and Highlights. There are no KPI tiles here — the numbers
 * live on the public dashboard.
 */

const CARD_ART: Record<string, { src: string; icon: React.ComponentType<{ className?: string }> }> = {
  citizen: { src: '/portal/hero-citizen.svg', icon: Users },
  developers: { src: '/portal/hero-developers.svg', icon: HardHat },
  ltp: { src: '/portal/hero-ltp.svg', icon: Ruler },
};

function ServiceCard({ section }: { section: PortalSection }) {
  const art = CARD_ART[section.key]!;
  const Icon = art.icon;
  const id = `service-${section.key}`;
  return (
    <article aria-labelledby={id} className="group relative isolate flex min-h-[27rem] flex-col overflow-hidden rounded-2xl bg-slate-900 shadow-elevated">
      {/* Decorative: the heading and the links carry all the meaning. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art.src} alt="" aria-hidden width={800} height={600} loading="lazy" className="absolute inset-0 -z-20 size-full object-cover transition-transform duration-700 group-hover:scale-105 motion-reduce:transition-none" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-slate-950/95 via-slate-950/75 to-slate-950/40 transition-colors duration-300 group-hover:from-slate-950/90 group-hover:via-slate-950/60" />

      <header className="px-6 pb-4 pt-6">
        <span className="mb-3 grid size-11 place-items-center rounded-xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-[2px]">
          <Icon className="size-5" aria-hidden />
        </span>
        <h2 id={id} className="text-2xl font-bold tracking-tight text-white">
          {section.title}
        </h2>
        <p className="mt-1 text-small text-slate-200">{section.blurb}</p>
      </header>

      <ul className="mt-auto space-y-1 p-3">
        {section.links.map((link) => (
          <li key={link.key}>
            <Link
              href={link.href}
              title={link.summary}
              className="flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-body font-medium text-white transition-colors hover:bg-white/20 focus-visible:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
            >
              <span>{link.label}</span>
              <ArrowRight className="size-4 shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function ServiceCards() {
  return (
    <section aria-label="Public services" className="bg-gradient-to-b from-slate-100 to-bg py-10 dark:from-slate-900">
      <Container>
        <div className="grid items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3">
          {SERVICE_SECTIONS.map((s) => (
            <ServiceCard key={s.key} section={s} />
          ))}
        </div>
      </Container>
    </section>
  );
}

export function WhatIsBim() {
  return (
    <section id="what-is-bim" aria-labelledby="bim-title" className="scroll-mt-4 bg-surface py-14">
      <Container className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <p className="text-small font-semibold uppercase tracking-widest text-primary">{BIM_INTRO.subtitle}</p>
          <h2 id="bim-title" className="mt-1 text-3xl font-bold tracking-tight text-text">
            {BIM_INTRO.title}
          </h2>
          <div className="mt-4 space-y-3 text-body text-text-muted">
            {BIM_INTRO.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {BIM_INTRO.points.map((pt, i) => {
              const Icon = [Layers, ClipboardCheck, ShieldCheck][i] ?? Layers;
              return (
                <li key={pt.title} className="rounded-xl border border-border bg-bg p-4">
                  <Icon className="size-5 text-primary" aria-hidden />
                  <p className="mt-2 font-semibold text-text">{pt.title}</p>
                  <p className="mt-1 text-small text-text-muted">{pt.text}</p>
                </li>
              );
            })}
          </ul>
        </div>
        <figure className="overflow-hidden rounded-2xl border border-border shadow-elevated">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/portal/bim-model.svg" alt="An isometric illustration of a five-storey building model, each floor slab outlined, with labels showing that every element carries its own level, thickness and setback data." width={800} height={600} loading="lazy" className="aspect-[4/3] w-full object-cover" />
          <figcaption className="border-t border-border bg-bg px-4 py-2 text-caption text-text-muted">An illustration of a BIM model: the floors are objects that carry their own data.</figcaption>
        </figure>
      </Container>
    </section>
  );
}

export function WhatIsBbas() {
  return (
    <section id="what-is-bbas" aria-labelledby="bbas-title" className="scroll-mt-4 bg-bg py-14">
      <Container>
        <div className="max-w-3xl">
          <p className="text-small font-semibold uppercase tracking-widest text-primary">{BBAS_INTRO.subtitle}</p>
          <h2 id="bbas-title" className="mt-1 text-3xl font-bold tracking-tight text-text">
            {BBAS_INTRO.title}
          </h2>
          <div className="mt-4 space-y-3 text-body text-text-muted">
            {BBAS_INTRO.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </div>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BBAS_INTRO.steps.map((step, i) => (
            <li key={step.title} className="relative rounded-xl border border-border bg-surface p-5 shadow-card">
              <span className="grid size-8 place-items-center rounded-full bg-primary text-small font-bold text-primary-text" aria-hidden>
                {i + 1}
              </span>
              <p className="mt-3 text-lg font-semibold text-text">
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </p>
              <p className="mt-1 text-small text-text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6">
          <Link href="/public/about" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            More about Nirman <ArrowRight className="size-4" aria-hidden />
          </Link>
        </p>
      </Container>
    </section>
  );
}

export function Explore() {
  return (
    <section id="explore" aria-labelledby="explore-title" className="scroll-mt-4 bg-surface py-14">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="explore-title" className="text-3xl font-bold tracking-tight text-text">
            Explore
          </h2>
          <Badge tone="warning">Demonstration announcements — not official news</Badge>
        </div>
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {EXPLORE_ITEMS.map((item) => (
            <li key={item.slug} className="flex">
              <article className="flex w-full flex-col rounded-xl border border-border bg-bg p-5 shadow-card transition-shadow hover:shadow-card-hover">
                <p className="flex items-center gap-1.5 text-caption text-text-muted">
                  <CalendarDays className="size-3.5" aria-hidden />
                  <time dateTime={item.date}>{fmtDay(item.date)}</time>
                </p>
                <h3 className="mt-2 text-lg font-semibold leading-snug text-text">{item.headline}</h3>
                <p className="mt-2 flex-1 text-small text-text-muted">{item.summary}</p>
                <Link href={`/public/explore/${item.slug}`} className="mt-4 inline-flex items-center gap-1 text-small font-semibold text-primary hover:underline" aria-label={`View: ${item.headline}`}>
                  View <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </article>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

export function Highlights() {
  return (
    <section id="highlights" aria-labelledby="highlights-title" className="scroll-mt-4 bg-bg py-14">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="highlights-title" className="text-3xl font-bold tracking-tight text-text">
            Highlights
          </h2>
          <Badge tone="warning">Demonstration content</Badge>
        </div>
        <ul className="mt-6 grid gap-5 md:grid-cols-2">
          {HIGHLIGHT_ITEMS.map((item, i) => {
            const Icon = [Building2, Ruler, FileSearch, ClipboardCheck][i % 4]!;
            return (
              <li key={item.title}>
                <article className={cn('flex h-full gap-4 rounded-xl border border-border bg-surface p-5 shadow-card')}>
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-subtle text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-caption text-text-muted">
                      <time dateTime={item.date}>{fmtDay(item.date)}</time>
                    </p>
                    <h3 className="mt-0.5 text-lg font-semibold text-text">{item.title}</h3>
                    <p className="mt-1 text-small text-text-muted">{item.summary}</p>
                    <Link href={item.href} className="mt-3 inline-flex items-center gap-1 text-small font-semibold text-primary hover:underline">
                      {item.cta} <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
