/**
 * The public portal's map — every link the public can follow, in one place.
 *
 * ── Why one catalogue ───────────────────────────────────────────────────
 *
 * The home page's service cards, the header, the footer, the portal map and
 * the service hubs all show the same destinations. Written out five times they
 * drift, and one of the copies ends up pointing at a page that was renamed —
 * which is exactly the dead link the portal is not allowed to have. Here every
 * surface reads this file, and `tests/unit/public-portal.test.ts` walks
 * `src/app` to prove each `href` below is a page that exists.
 *
 * Isomorphic and dependency-free on purpose: the client bundle, the server and
 * the tests all import it.
 */

export type PortalLink = {
  /** Stable key, used by tests and for anchors. */
  key: string;
  label: string;
  /** Always a real route (or a real anchor on one). Never `#`. */
  href: string;
  /** One sentence, shown on the service hubs and the portal map. */
  summary: string;
};

export type PortalSection = {
  key: string;
  title: string;
  blurb: string;
  /** The hub page for the section, when it has one. */
  href?: string;
  links: PortalLink[];
};

/** The existing sign-in page. The portal has no login of its own. */
export const LOGIN_HREF = '/login';
/** Where a signed-in officer or LTP goes from the portal. */
export const WORKSPACE_HREF = '/dashboard';

// ── The three service columns on the home page ──────────────────────────────

export const CITIZEN_SERVICE: PortalSection = {
  key: 'citizen',
  title: 'Citizen Service',
  blurb: 'Pay a fee or follow a file — no login needed.',
  links: [
    { key: 'pay-fees', label: 'Pay your fees here', href: '/public/pay-fees', summary: 'Look up the fee demand and payment record for an application.' },
    { key: 'status', label: 'Search your application status', href: '/public/status', summary: 'See where a building permission application stands.' },
  ],
};

export const DEVELOPER_SERVICE: PortalSection = {
  key: 'developers',
  title: 'Developer & TPAs',
  blurb: 'Register, renew and check developers and Town Planning Assistants.',
  href: '/public/developers',
  links: [
    { key: 'developer-register', label: 'Developer Registration', href: '/public/developers/register', summary: 'Apply to be registered as a developer with the authority.' },
    { key: 'developer-status', label: 'Developer Registration Status', href: '/public/developers/status', summary: 'Track a developer registration by its registration or reference number.' },
    { key: 'developer-renewal', label: 'Developer Renewal', href: '/public/developers/renewal', summary: 'Renew a developer registration that is due or has lapsed.' },
    { key: 'developer-list', label: 'List of Registered Developer', href: '/public/developers/list', summary: 'Search the public register of developers.' },
    { key: 'developer-consent', label: 'Developer Consent Link', href: '/public/developers/consent', summary: 'Give a developer’s consent to be named on an application (demo).' },
    { key: 'tpa-consent', label: 'TPAs Consent Link', href: '/public/tpas/consent', summary: 'Give a Town Planning Assistant’s consent for an application (demo).' },
    { key: 'tpa-list', label: 'List of Registered TPAs', href: '/public/tpas/list', summary: 'See the Town Planning Assistants serving each zone.' },
  ],
};

export const LTP_SERVICE: PortalSection = {
  key: 'ltp',
  title: 'LTP',
  blurb: 'Licensed Technical Persons: register, renew and be found.',
  href: '/public/ltp',
  links: [
    { key: 'ltp-register', label: 'New Registration', href: '/public/ltp/register', summary: 'Apply to be registered as a Licensed Technical Person.' },
    { key: 'ltp-list', label: 'List of Registered LTPs', href: '/public/ltp/list', summary: 'Search the public register of Licensed Technical Persons.' },
    { key: 'ltp-renewal', label: 'LTP Renewal', href: '/public/ltp/renewal', summary: 'Renew an LTP registration.' },
    { key: 'ltp-payment-renewal', label: 'Payment and Renewal', href: '/public/ltp/payment-renewal', summary: 'Renewal reference, payment status and renewal status together.' },
    { key: 'ltp-view', label: 'LTP View', href: '/public/ltp/view', summary: 'See a registered LTP’s public profile.' },
    { key: 'ltp-consent', label: 'LTP Consent Link', href: '/public/ltp/consent', summary: 'Give an LTP’s consent to act on an application (demo).' },
  ],
};

export const SERVICE_SECTIONS: readonly PortalSection[] = [CITIZEN_SERVICE, DEVELOPER_SERVICE, LTP_SERVICE];

// ── Information and support ─────────────────────────────────────────────────

export const HOME_LINK: PortalLink = { key: 'home', label: 'Home', href: '/', summary: 'The portal’s front page.' };
export const DASHBOARD_LINK: PortalLink = { key: 'dashboard', label: 'Dashboard', href: '/public/dashboard', summary: 'Live counts of applications and permissions issued.' };
export const DOWNLOADS_LINK: PortalLink = { key: 'downloads', label: 'Downloads', href: '/public/downloads', summary: 'Guides, help manuals and reference documents.' };
export const LOGIN_LINK: PortalLink = { key: 'login', label: 'Login', href: LOGIN_HREF, summary: 'Sign in to the BBAS workspace.' };

export const ABOUT_LINK: PortalLink = { key: 'about', label: 'About Us', href: '/public/about', summary: 'What BBAS is, and what BIM and BBAS mean here.' };
export const HELP_MANUALS_LINK: PortalLink = { key: 'help-manuals', label: 'Help Manuals', href: '/public/downloads#user-manuals', summary: 'Step-by-step guides for applicants.' };
export const FAQ_LINK: PortalLink = { key: 'faq', label: 'FAQ', href: '/public/faq', summary: 'Answers to common questions.' };
export const HELPDESK_LINK: PortalLink = { key: 'helpdesk', label: 'Helpdesk', href: '/public/helpdesk', summary: 'How to get help, and when.' };
export const CONTACT_LINK: PortalLink = { key: 'contact', label: 'Contact Us', href: '/public/contact', summary: 'Where to reach the project team.' };
export const PORTAL_MAP_LINK: PortalLink = { key: 'portal-map', label: 'Portal Map', href: '/public/portal-map', summary: 'Every public service on one page.' };
export const PRIVACY_LINK: PortalLink = { key: 'privacy', label: 'Privacy', href: '/public/privacy', summary: 'What the public pages read and what they never show.' };
export const ACCESSIBILITY_LINK: PortalLink = { key: 'accessibility', label: 'Accessibility', href: '/public/accessibility', summary: 'Text size, contrast, keyboard and screen-reader support.' };
export const SCREEN_READER_LINK: PortalLink = { key: 'screen-reader', label: 'Screen Reader Access', href: '/public/accessibility#screen-reader', summary: 'How to use the portal with a screen reader.' };
export const WHAT_IS_BIM_LINK: PortalLink = { key: 'what-is-bim', label: 'What is BIM?', href: '/#what-is-bim', summary: 'Building Information Modelling, briefly.' };
export const WHAT_IS_BBAS_LINK: PortalLink = { key: 'what-is-bbas', label: 'What is BBAS?', href: '/#what-is-bbas', summary: 'The BIM Based Building Approval System.' };
export const EXPLORE_LINK: PortalLink = { key: 'explore', label: 'Explore', href: '/#explore', summary: 'Announcements (demonstration content).' };
export const HIGHLIGHTS_LINK: PortalLink = { key: 'highlights', label: 'Highlights', href: '/#highlights', summary: 'Highlights of the portal (demonstration content).' };

/** The top bar. Login is the existing sign-in page. */
export const HEADER_NAV: readonly PortalLink[] = [HOME_LINK, DASHBOARD_LINK, DOWNLOADS_LINK, LOGIN_LINK];

export const FOOTER_PORTAL_MAP: readonly PortalLink[] = [HOME_LINK, ABOUT_LINK, DASHBOARD_LINK, DOWNLOADS_LINK, PORTAL_MAP_LINK];
export const FOOTER_SUPPORT: readonly PortalLink[] = [HELP_MANUALS_LINK, FAQ_LINK, HELPDESK_LINK, CONTACT_LINK];
export const FOOTER_LEGAL: readonly PortalLink[] = [PRIVACY_LINK, ACCESSIBILITY_LINK];

export const PORTAL_MAP_SECTIONS: readonly PortalSection[] = [
  ...SERVICE_SECTIONS,
  {
    key: 'information',
    title: 'Information',
    blurb: 'About the system, and live figures from it.',
    links: [HOME_LINK, ABOUT_LINK, WHAT_IS_BIM_LINK, WHAT_IS_BBAS_LINK, EXPLORE_LINK, HIGHLIGHTS_LINK, DASHBOARD_LINK, DOWNLOADS_LINK],
  },
  {
    key: 'support',
    title: 'Support',
    blurb: 'Help, in the order you are likely to need it.',
    links: [HELP_MANUALS_LINK, FAQ_LINK, HELPDESK_LINK, CONTACT_LINK, ACCESSIBILITY_LINK, SCREEN_READER_LINK, PRIVACY_LINK, LOGIN_LINK],
  },
];

/** Every distinct link the public portal offers, for the link checks. */
export function allPortalLinks(): PortalLink[] {
  const seen = new Map<string, PortalLink>();
  const add = (l: PortalLink) => seen.set(l.href, seen.get(l.href) ?? l);
  HEADER_NAV.forEach(add);
  SERVICE_SECTIONS.forEach((s) => s.links.forEach(add));
  PORTAL_MAP_SECTIONS.forEach((s) => s.links.forEach(add));
  [...FOOTER_PORTAL_MAP, ...FOOTER_SUPPORT, ...FOOTER_LEGAL].forEach(add);
  return [...seen.values()];
}

/** The path a link lands on, without its `#anchor` or `?query`. */
export const pathOf = (href: string) => href.split('#')[0]!.split('?')[0]! || '/';

/** True for a link that stays inside the portal and so must resolve to a page. */
export const isInternalHref = (href: string) => href.startsWith('/') && !href.startsWith('//');

// ── Vocabulary the public pages share ───────────────────────────────────────

/**
 * The public words for a registration's status. Coarser than the internal
 * ones on purpose: "Verified" and "Shortfall" describe the department's
 * handling of a file, and the public register says only what somebody outside
 * needs — is it in force, is it being looked at, is it waiting on them.
 */
export const PUBLIC_REGISTRATION_STATUS: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }> = {
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  IN_PROCESS: { label: 'Under process', tone: 'info' },
  VERIFIED: { label: 'Under process', tone: 'info' },
  SHORTFALL: { label: 'Awaiting applicant response', tone: 'warning' },
  APPROVED: { label: 'Registered', tone: 'success' },
  REJECTED: { label: 'Not approved', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

export const publicRegistrationStatus = (status: string) => PUBLIC_REGISTRATION_STATUS[status] ?? { label: 'Under process', tone: 'info' as const };

/** What the public dashboard's status filter offers. Keys are the public vocabulary, never internal statuses. */
export const DASHBOARD_STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_PROCESS', label: 'Under process' },
  { value: 'SHORTFALL', label: 'With shortfall' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'NOT_APPROVED', label: 'Not approved' },
] as const;

export type DashboardStatusFilter = (typeof DASHBOARD_STATUS_FILTERS)[number]['value'];
export const isDashboardStatusFilter = (v: string): v is DashboardStatusFilter => DASHBOARD_STATUS_FILTERS.some((f) => f.value === v);

/** The one sentence every demonstration surface carries, so nobody mistakes it for an official site. */
export const DEMO_NOTICE = 'Demonstration portal. BBAS is a demonstration system and is not an official government website; records shown here are fictional.';
