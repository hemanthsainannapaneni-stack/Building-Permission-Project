import Link from 'next/link';
import {
  CONTACT_LINK,
  DASHBOARD_LINK,
  DOWNLOADS_LINK,
  FOOTER_LEGAL,
  FOOTER_PORTAL_MAP,
  FOOTER_SUPPORT,
  HOME_LINK,
  LOGIN_LINK,
  WORKSPACE_HREF,
} from '@/lib/public-portal';
import { PublicNav } from './nav';
import { Preferences } from './preferences';
import { Container } from './primitives';

/**
 * The frame of every public page: accessibility bar, identity, navigation,
 * the page, and the footer.
 *
 * ── Identity, and what it is not ────────────────────────────────────────
 *
 * The brand is Nirman's own — its logo and name. No government seal is shown
 * because none has been supplied, and the portal says on every page that it is
 * a demonstration. It is a BBAS-STYLE portal, not the official one.
 *
 * ── Login is the existing sign-in ───────────────────────────────────────
 *
 * The portal has no authentication of its own. "Login" goes to `/login`. A
 * visitor who is already signed in sees "My workspace" in its place, which
 * goes to the dashboard — the only thing about the frame that depends on who
 * is looking, so it is the only thing that does.
 */
export function PublicShell({ children, appName, isSignedIn }: { children: React.ReactNode; appName: string; isSignedIn: boolean }) {
  const items = [
    { label: HOME_LINK.label, href: HOME_LINK.href },
    { label: DASHBOARD_LINK.label, href: DASHBOARD_LINK.href },
    { label: DOWNLOADS_LINK.label, href: DOWNLOADS_LINK.href },
    isSignedIn ? { label: 'My workspace', href: WORKSPACE_HREF } : { label: LOGIN_LINK.label, href: LOGIN_LINK.href },
  ];

  return (
    <div className="public-portal flex min-h-screen flex-col bg-bg text-text">
      <header>
        <div className="bg-slate-900 text-white">
          <Container className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-1.5">
            <p className="text-caption text-slate-300">BBAS-style Building Permission Demo · not an official government website</p>
            <Preferences />
          </Container>
        </div>

        <div className="border-b border-border bg-surface">
          <Container className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
            <Link href="/" className="flex items-center gap-3 rounded-lg focus-visible:outline-2" aria-label={`${appName} — Building Permission Authority, home`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/portal/nirman-logo.jpg" alt="" width={56} height={56} className="size-14 rounded-xl object-cover shadow-card" />
              <span>
                <span className="block text-2xl font-extrabold leading-none tracking-wide text-text">NIRMAN</span>
                <span className="mt-1 block text-small font-medium text-text-muted">Building Permission Authority</span>
              </span>
            </Link>
            <div className="text-left sm:text-right">
              <p className="text-h1 font-semibold text-text">Building Permission Portal</p>
              <p className="text-small text-text-muted">BBAS-style Building Permission Demo · BIM Based Building Approval</p>
            </div>
          </Container>
        </div>

        <div className="relative">
          <PublicNav items={items} />
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>

      <footer className="mt-auto border-t border-border bg-slate-900 text-slate-200">
        <Container className="grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <p className="text-lg font-bold tracking-wide text-white">NIRMAN</p>
            <p className="text-small text-slate-300">A BBAS-style building permission demonstration: citizens, developers, LTPs and Town Planning Assistants, on one portal.</p>
          </div>
          <FooterList title="Portal Map" links={FOOTER_PORTAL_MAP} />
          <FooterList title="Support" links={FOOTER_SUPPORT} />
          <FooterList title="Policies" links={FOOTER_LEGAL} extra={[{ label: CONTACT_LINK.label, href: CONTACT_LINK.href }]} />
        </Container>
        <div className="border-t border-white/10">
          <Container className="py-4 text-caption text-slate-400">
            <p>© Nirman / Demo Building Permission Authority. A demonstration system — it is not the official APCRDA BBAS portal, and nothing filed here has any legal effect.</p>
          </Container>
        </div>
      </footer>
    </div>
  );
}

function FooterList({ title, links, extra = [] }: { title: string; links: readonly { label: string; href: string }[]; extra?: { label: string; href: string }[] }) {
  return (
    <nav aria-label={title}>
      <h2 className="mb-3 text-small font-semibold uppercase tracking-wider text-white">{title}</h2>
      <ul className="space-y-2 text-small">
        {[...links, ...extra].map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="rounded text-slate-300 hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-white">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
