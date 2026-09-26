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
import { PublicNav } from './nav';
import { Container } from './primitives';

/**
 * The frame of every public page: accessibility bar, identity, navigation,
 * the page, and the footer.
 *
 * ── Identity, and what it is not ────────────────────────────────────────
 *
 * The brand is BBAS's own — its logo and name. No government seal is shown
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
export function PublicShell({ children, isSignedIn }: { children: React.ReactNode; isSignedIn: boolean }) {
  const items = [
    { label: HOME_LINK.label, href: HOME_LINK.href },
    { label: DASHBOARD_LINK.label, href: DASHBOARD_LINK.href },
    { label: DOWNLOADS_LINK.label, href: DOWNLOADS_LINK.href },
    isSignedIn ? { label: 'My workspace', href: WORKSPACE_HREF } : { label: LOGIN_LINK.label, href: LOGIN_LINK.href },
  ];

  return (
    <div className="public-portal flex min-h-screen flex-col bg-bg text-text">
      <header className="bg-white">
        {/* Top Accessibility Bar */}
        <div className="border-b border-border text-xs text-text-muted font-medium bg-[#fafafa]">
          <Container className="flex justify-end items-center gap-3 py-1.5 px-4">
            <a href="#main-content" className="hover:underline">Skip to Main Content</a>
            <span className="text-border">|</span>
            <div className="flex items-center gap-1.5">
              <button className="flex items-center justify-center h-5 w-5 rounded-full bg-slate-500 text-white text-[10px] hover:bg-slate-600">A+</button>
              <button className="flex items-center justify-center h-5 w-5 rounded-full bg-slate-500 text-white text-[10px] hover:bg-slate-600">A</button>
              <button className="flex items-center justify-center h-5 w-5 rounded-full bg-slate-500 text-white text-[10px] hover:bg-slate-600">A-</button>
            </div>
            <span className="text-border">|</span>
            <div className="flex items-center gap-1.5">
              <button className="h-5 w-5 rounded-full bg-[#1e1346] hover:opacity-80 border border-transparent" aria-label="High contrast theme"></button>
              <button className="h-5 w-5 rounded-full border border-border bg-white hover:opacity-80" aria-label="Default theme"></button>
            </div>
            <span className="text-border">|</span>
            <button className="hover:underline">Screen Reader Access</button>
          </Container>
        </div>

        {/* Logo / Title Bar */}
        <div className="border-b border-border py-2 bg-[#fdfaf2]">
          <Container className="flex items-center justify-between px-4">
            
            {/* Left side: Minister */}
            <div className="flex items-center gap-4">
              <img src="/portal/minister.png" alt="Minister Sri Ponguru Narayana" className="h-20 w-auto object-contain drop-shadow-sm" />
              <div className="hidden md:block">
                <p className="text-[#8c1c13] font-bold text-sm tracking-wide">Sri Ponguru Narayana</p>
                <p className="text-xs text-slate-800 font-medium">Hon&apos;ble Minister for MA&amp;UD</p>
                <p className="text-xs text-slate-800 font-medium">Andhra Pradesh Government</p>
              </div>
            </div>

            {/* Center-left: APCRDA */}
            <div className="hidden lg:flex items-center justify-center">
              <img src="/portal/apcrda.png" alt="APCRDA Logo" className="h-16 w-auto object-contain" />
            </div>

            {/* Center: BBAS */}
            <div className="text-center px-4">
              <h1 className="text-[#8c1c13] text-4xl md:text-5xl font-extrabold tracking-widest leading-none font-sans">
                BBAS
              </h1>
            </div>

            {/* Center-right: AP Govt Logo */}
            <div className="hidden lg:flex items-center justify-center">
              <img src="/portal/ap-logo.jpg" alt="AP Government Logo" className="h-16 w-16 object-contain rounded-full mix-blend-multiply" />
            </div>

            {/* Right side: Chief Minister */}
            <div className="flex items-center gap-4 text-right">
              <div className="hidden md:block">
                <p className="text-[#8c1c13] font-bold text-sm tracking-wide">Sri Nara Chandrababu Naidu</p>
                <p className="text-xs text-slate-800 font-medium">Hon&apos;ble Chief Minister</p>
                <p className="text-xs text-slate-800 font-medium">Andhra Pradesh Government</p>
              </div>
              <img src="/portal/cm.png" alt="Chief Minister Sri Nara Chandrababu Naidu" className="h-20 w-auto object-contain drop-shadow-sm" />
            </div>

          </Container>
        </div>

        {/* Navigation Bar */}
        <div className="relative border-b border-border bg-[#fafafa]">
          <PublicNav items={items} />
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>

      <footer className="mt-auto border-t border-border bg-slate-900 text-slate-200">
        <Container className="grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <p className="text-lg font-bold tracking-wide text-white">BBAS</p>
            <p className="text-small text-slate-300">A BBAS-style building permission demonstration: citizens, developers, LTPs and Town Planning Assistants, on one portal.</p>
          </div>
          <FooterList title="Portal Map" links={FOOTER_PORTAL_MAP} />
          <FooterList title="Support" links={FOOTER_SUPPORT} />
          <FooterList title="Policies" links={FOOTER_LEGAL} extra={[{ label: CONTACT_LINK.label, href: CONTACT_LINK.href }]} />
        </Container>
        <div className="border-t border-white/10">
          <Container className="py-4 text-caption text-slate-400">
            <p>© BBAS / Demo Building Permission Authority. A demonstration system — it is not the official APCRDA BBAS portal, and nothing filed here has any legal effect.</p>
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
