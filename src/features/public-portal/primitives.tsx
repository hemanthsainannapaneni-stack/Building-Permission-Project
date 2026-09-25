import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight, FlaskConical, Home, Info, SearchX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { DEMO_NOTICE } from '@/lib/public-portal';

/**
 * The small pieces every public page is built from. None holds state, so all of
 * them render on the server and the pages that use them work without script.
 */

export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8', className)}>{children}</div>;
}

export type Crumb = { label: string; href?: string };

/**
 * The frame of an inner page: breadcrumb, heading, intro, then content.
 *
 * The breadcrumb is the page's "Back" path — Home, then the service it belongs
 * to — and the same two links are repeated at the foot, so a visitor who has
 * scrolled to the bottom of a long form is not stranded there.
 */
export function PageFrame({
  title,
  intro,
  crumbs = [],
  back,
  children,
  demo = false,
}: {
  title: string;
  intro?: React.ReactNode;
  crumbs?: Crumb[];
  /** The service hub this page belongs to, for the foot links. */
  back?: { label: string; href: string };
  children: React.ReactNode;
  demo?: boolean;
}) {
  return (
    <div className="bg-bg">
      <div className="border-b border-border bg-surface">
        <Container className="py-5">
          <nav aria-label="Breadcrumb" className="mb-3">
            <ol className="flex flex-wrap items-center gap-1 text-small text-text-muted">
              <li className="flex items-center gap-1">
                <Link href="/" className="inline-flex items-center gap-1 rounded text-primary hover:underline">
                  <Home className="size-3.5" aria-hidden /> Home
                </Link>
              </li>
              {crumbs.map((c, i) => (
                <li key={c.label} className="flex items-center gap-1">
                  <ChevronRight className="size-3.5 text-text-subtle" aria-hidden />
                  {c.href && i < crumbs.length ? (
                    <Link href={c.href} className="rounded text-primary hover:underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </li>
              ))}
              <li className="flex items-center gap-1" aria-current="page">
                <ChevronRight className="size-3.5 text-text-subtle" aria-hidden />
                <span className="font-medium text-text">{title}</span>
              </li>
            </ol>
          </nav>
          <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">{title}</h1>
          {intro && <div className="mt-2 max-w-3xl text-body text-text-muted">{intro}</div>}
        </Container>
      </div>

      <Container className="space-y-6 py-8">
        {demo && <DemoBanner />}
        {children}
        <nav aria-label="Page navigation" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-5 text-small">
          {back && (
            <Link href={back.href} className="rounded text-primary hover:underline">
              ← Back to {back.label}
            </Link>
          )}
          <Link href="/" className="rounded text-primary hover:underline">
            ← Portal home
          </Link>
        </nav>
      </Container>
    </div>
  );
}

/** The one line every demonstration surface carries. */
export function DemoBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-small text-text">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p>
        <strong className="font-semibold">Demo. </strong>
        {children ?? DEMO_NOTICE}
      </p>
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn('rounded-xl border border-border bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 px-5 py-4">
          <div>
            {title && (
              <h2 id={id ? `${id}-title` : undefined} className="text-lg font-semibold text-text">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-small text-text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/** A definition list laid out as a responsive grid of label / value pairs. */
export function Facts({ items, columns = 3 }: { items: { label: string; value: React.ReactNode }[]; columns?: 2 | 3 | 4 }) {
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[columns];
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', cols)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-caption font-medium uppercase tracking-wide text-text-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words text-body font-medium text-text">{it.value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';
export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}

/**
 * A lookup form that submits with GET.
 *
 * The result page is the same route with the reference in its query string, so
 * a result can be bookmarked, sent to somebody, or returned to with the Back
 * button — and the form works before any script has loaded.
 */
export function LookupForm({
  action,
  fields,
  submitLabel = 'Search',
  hidden = {},
  className,
}: {
  action: string;
  fields: { name: string; label: string; placeholder?: string; defaultValue?: string; required?: boolean; hint?: string; inputMode?: 'numeric' | 'text'; maxLength?: number; type?: string }[];
  submitLabel?: string;
  hidden?: Record<string, string>;
  className?: string;
}) {
  return (
    <form method="get" action={action} className={cn('grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] sm:items-start', className)}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <div key={f.name} className="space-y-1.5">
          <Label htmlFor={`f-${f.name}`} required={f.required}>
            {f.label}
          </Label>
          <Input
            id={`f-${f.name}`}
            name={f.name}
            type={f.type ?? 'search'}
            defaultValue={f.defaultValue}
            placeholder={f.placeholder}
            required={f.required}
            inputMode={f.inputMode}
            maxLength={f.maxLength}
            autoComplete="off"
            aria-describedby={f.hint ? `f-${f.name}-hint` : undefined}
          />
          {f.hint && (
            <p id={`f-${f.name}-hint`} className="text-caption text-text-muted">
              {f.hint}
            </p>
          )}
        </div>
      ))}
      <div className="sm:self-end">
        <Button type="submit" variant="primary" className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Empty, not-found and error states share one shape so they read as siblings. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'neutral';
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon = tone === 'danger' || tone === 'warning' ? AlertTriangle : tone === 'neutral' ? SearchX : Info;
  const ring = { info: 'border-info/30 bg-info-bg', warning: 'border-warning/40 bg-warning-bg', danger: 'border-danger/30 bg-danger-bg', neutral: 'border-border bg-surface-sunk' }[tone];
  const ink = { info: 'text-info', warning: 'text-warning', danger: 'text-danger', neutral: 'text-text-subtle' }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-xl border px-5 py-4', ring)}>
      <Icon className={cn('mt-0.5 size-5 shrink-0', ink)} aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold text-text">{title}</p>
        {children && <div className="mt-1 text-small text-text-muted">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export const NotFoundNotice = ({ what, hint }: { what: string; hint?: string }) => (
  <Notice tone="neutral" title={`No ${what} found.`}>
    {hint ?? 'Check the number and try again. The search matches a complete number only.'}
  </Notice>
);

export const ThrottledNotice = ({ seconds }: { seconds: number }) => (
  <Notice tone="warning" title="Too many lookups from this connection.">
    Please wait about {Math.max(1, Math.ceil(seconds / 5) * 5)} seconds and search again.
  </Notice>
);

export const LoadFailedNotice = ({ retryHref }: { retryHref: string }) => (
  <Notice
    tone="danger"
    title="That page could not be loaded."
    action={
      <Button asChild variant="secondary" size="sm">
        <Link href={retryHref}>Try again</Link>
      </Button>
    }
  >
    Nothing has been changed. If it keeps happening, use the Helpdesk page.
  </Notice>
);

/** Numbered pager for a server-rendered list; every page is a link, so it works without script. */
export function Pager({ page, totalPages, total, noun, hrefFor }: { page: number; totalPages: number; total: number; noun: string; hrefFor: (page: number) => string }) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1);
  return (
    <nav aria-label={`${noun} pages`} className="flex flex-wrap items-center justify-between gap-3 text-small">
      <p className="text-text-muted" aria-live="polite">
        {total === 0 ? `No ${noun}s` : `${total} ${noun}${total === 1 ? '' : 's'} · page ${page} of ${totalPages}`}
      </p>
      {totalPages > 1 && (
        <ul className="flex items-center gap-1">
          <li>
            {page > 1 ? (
              <Link href={hrefFor(page - 1)} rel="prev" className="inline-flex h-8 items-center rounded-md border border-border px-3 hover:bg-surface-sunk">
                Previous
              </Link>
            ) : (
              <span className="inline-flex h-8 items-center rounded-md border border-border px-3 text-text-subtle" aria-disabled>
                Previous
              </span>
            )}
          </li>
          {pages.map((p, i) => (
            <li key={p} className="flex items-center gap-1">
              {i > 0 && pages[i - 1] !== p - 1 && <span aria-hidden>…</span>}
              <Link
                href={hrefFor(p)}
                aria-current={p === page ? 'page' : undefined}
                className={cn('inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2', p === page ? 'border-primary bg-primary text-primary-text' : 'border-border hover:bg-surface-sunk')}
              >
                {p}
              </Link>
            </li>
          ))}
          <li>
            {page < totalPages ? (
              <Link href={hrefFor(page + 1)} rel="next" className="inline-flex h-8 items-center rounded-md border border-border px-3 hover:bg-surface-sunk">
                Next
              </Link>
            ) : (
              <span className="inline-flex h-8 items-center rounded-md border border-border px-3 text-text-subtle" aria-disabled>
                Next
              </span>
            )}
          </li>
        </ul>
      )}
    </nav>
  );
}

/** A scrollable table wrapper: a wide table scrolls inside itself, never the page. */
export function TableFrame({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[40rem] border-collapse text-left text-body">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th scope="col" className={cn('border-b border-border bg-surface-sunk px-4 py-3 text-caption font-semibold uppercase tracking-wide text-text-muted', className)}>
    {children}
  </th>
);
export const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => <td className={cn('border-b border-border/70 px-4 py-3 align-top', className)}>{children}</td>;
