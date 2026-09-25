/**
 * Words and catalogues for the public portal's information pages.
 *
 * ── Everything here is demonstration content, and says so ───────────────
 *
 * No official notice, order, circular or contact detail was supplied to this
 * project. Rather than write something that reads as if it were one, the
 * items below are plainly fictional or plainly descriptive, and each surface
 * that shows them carries a "Demo" mark. When real content is supplied it
 * replaces these strings; nothing else changes.
 *
 * Numbers never live here. Every figure the portal shows (the dashboard, the
 * registers, the counts on a profile) is read from the database.
 */

// ── What is BIM? / What is BBAS? ────────────────────────────────────────────

export const BIM_INTRO = {
  title: 'What is BIM?',
  subtitle: 'Building Information Modelling',
  paragraphs: [
    'BIM is a way of describing a building as a single digital model instead of a stack of separate drawings. Every wall, slab, door and staircase in the model is an object that knows what it is, where it sits and how big it is.',
    'Because the model carries its own measurements, a rule such as a setback, a height limit or a floor-area ratio can be checked against it directly, and a change made once shows up in every view of the building.',
  ],
  points: [
    { title: 'One model', text: 'Plans, sections and elevations come from the same source, so they cannot disagree.' },
    { title: 'Data, not just lines', text: 'Areas, heights and uses are stored on the objects themselves and can be read by the system.' },
    { title: 'Checkable', text: 'Planning rules can be run against the model and the result traced back to the element that caused it.' },
  ],
};

export const BBAS_INTRO = {
  title: 'What is BBAS?',
  subtitle: 'BIM Based Building Approval System',
  paragraphs: [
    'BBAS-style systems put building permission online. A Licensed Technical Person (LTP) prepares the application, attaches the drawings or BIM model, pays the fee and follows the file until a Building Permission Order is issued.',
    'Inside the authority the file passes through named desks — scrutiny, inspection, verification and approval — and every step is recorded. After approval the same file carries on through commencement of work and, later, occupancy.',
    'BBAS is a BBAS-style Building Permission Demo. It is a demonstration system, not the official APCRDA BBAS portal. This public portal is the part anyone can open: citizens track a file and its fees, and developers, LTPs and Town Planning Assistants are registered, renewed and listed.',
  ],
  steps: [
    { title: 'Prepare', text: 'The LTP fills in the application and attaches the drawings or BIM model.' },
    { title: 'Scrutinise', text: 'The model and documents are checked; objections come back as a shortfall.' },
    { title: 'Approve', text: 'The file moves through the approval desks and a Building Permission Order is issued.' },
    { title: 'Build', text: 'Commencement of work is recorded, and occupancy follows completion.' },
  ],
};

// ── Explore (announcements) and Highlights ──────────────────────────────────

export type ExploreItem = {
  slug: string;
  headline: string;
  /** ISO date. Fictional. */
  date: string;
  summary: string;
  body: string[];
};

export const EXPLORE_ITEMS: readonly ExploreItem[] = [
  {
    slug: 'status-search-without-login',
    headline: 'Track a file without signing in',
    date: '2026-09-22',
    summary: 'Anyone with an application number can now see a file’s public status and fee record from the portal.',
    body: [
      'The Citizen Service card on the home page opens the status search and the fee lookup directly. Both need only an application or proceeding number.',
      'The public view shows the application number, permission type, submission date, current status, payment status and, once issued, the proceeding number. It never shows officer remarks, internal notes or documents.',
    ],
  },
  {
    slug: 'public-registers',
    headline: 'Registers of developers and LTPs now searchable',
    date: '2026-09-18',
    summary: 'The developer, LTP and TPA lists show registration numbers, status and validity, and nothing private.',
    body: [
      'Each register lists only registrations that have been decided by the authority. Contact details, identity numbers and internal remarks are not part of the public view.',
      'A registration that has lapsed stays on the list with the status Expired, so a reader can tell the difference between never registered and no longer in force.',
    ],
  },
  {
    slug: 'bim-model-guidance',
    headline: 'Guidance for preparing a BIM model',
    date: '2026-09-10',
    summary: 'A short demonstration guide on naming, levels and units when attaching a model to an application.',
    body: [
      'The guide is a demonstration document written for this portal. It is not an official specification.',
      'It covers naming levels consistently, keeping one unit system throughout the model and placing the plot boundary on its own layer so it can be checked.',
    ],
  },
  {
    slug: 'planned-maintenance',
    headline: 'Planned maintenance window',
    date: '2026-09-05',
    summary: 'A demonstration notice showing where service announcements will appear.',
    body: [
      'This is a fictional notice. It shows where a real announcement about downtime or a change in process would be published.',
    ],
  },
];

export type HighlightItem = { date: string; title: string; summary: string; href: string; cta: string };

export const HIGHLIGHT_ITEMS: readonly HighlightItem[] = [
  { date: '2026-09-24', title: 'Developer registration and renewal online', summary: 'File a registration or a renewal from the portal; the authority verifies it before it takes effect.', href: '/public/developers/register', cta: 'Register a developer' },
  { date: '2026-09-23', title: 'Licensed Technical Person register', summary: 'Apply to be registered as an LTP, or check an LTP before you engage them.', href: '/public/ltp/list', cta: 'Open the LTP register' },
  { date: '2026-09-20', title: 'Live figures on the public dashboard', summary: 'Applications received, under process, approved and permissions issued, read from the system itself.', href: '/public/dashboard', cta: 'See the dashboard' },
  { date: '2026-09-12', title: 'A step-by-step guide to applying', summary: 'A demonstration guide to preparing and submitting a building permission application.', href: '/public/downloads#application-guidelines', cta: 'Read the guide' },
];

// ── FAQ ─────────────────────────────────────────────────────────────────────

export type FaqItem = { id: string; question: string; answer: string[]; href?: string; hrefLabel?: string };

/**
 * Written to describe how THIS portal behaves. None of it states a legal
 * requirement, a fee amount or a time limit — those belong to the authority,
 * and none was supplied.
 */
export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: 'how-to-apply',
    question: 'How do I apply for a building permission?',
    answer: [
      'Applications are prepared and submitted by a Licensed Technical Person (LTP) who signs in to the BBAS workspace. The LTP enters the plot and building details, attaches the drawings or BIM model and the required documents, and submits the file.',
      'If you are an owner, ask your LTP to file the application. You can then follow it from this portal with the application number.',
    ],
    href: '/public/downloads#application-guidelines',
    hrefLabel: 'How to apply',
  },
  {
    id: 'application-status',
    question: 'How can I check the status of my application?',
    answer: ['Open “Search your application status” and enter the application number or, once issued, the proceeding number. The page shows a plain-language status, the payment status and whether a permission order has been issued.'],
    href: '/public/status',
    hrefLabel: 'Search application status',
  },
  {
    id: 'fees',
    question: 'Where can I see the fee for an application?',
    answer: [
      'The fee is calculated by the system from the fee schedule configured for the permission type and shown as a demand against the application. “Pay your fees here” shows the demand, what has been paid and the payment history for an application number.',
      'In this demonstration no real money moves. Paying happens from the applicant’s own workspace, using the demonstration payment gateway.',
    ],
    href: '/public/pay-fees',
    hrefLabel: 'Look up fees',
  },
  {
    id: 'shortfall',
    question: 'What is a shortfall?',
    answer: ['A shortfall is a request from the authority for something to be corrected or supplied — a missing document, a drawing issue or a fee difference. The file waits with the applicant until it is answered. The public status shows “Awaiting applicant response” while that is the case; the details are shared with the applicant only.'],
  },
  {
    id: 'developer-registration',
    question: 'How do I register as a developer?',
    answer: ['Use “Developer Registration”. Give the developer’s particulars, PAN and registration details and attach the supporting documents. The application goes to the authority for verification and decision, and you can follow it under “Developer Registration Status”.'],
    href: '/public/developers/register',
    hrefLabel: 'Developer Registration',
  },
  {
    id: 'ltp-registration',
    question: 'How do I register as a Licensed Technical Person?',
    answer: ['Use “New Registration” under LTP. Enter your licence details, attach the supporting documents and give your consent. The authority verifies the documents and decides the application; the result appears in the public register once decided.'],
    href: '/public/ltp/register',
    hrefLabel: 'LTP New Registration',
  },
  {
    id: 'renewal',
    question: 'How do I renew a registration?',
    answer: ['Developers and LTPs renew from the renewal pages by giving the registration number. A renewal opens when the registration’s renewal window begins and can also be filed after a registration has lapsed. The renewal is a new application, checked afresh, and the registration number stays the same.'],
    href: '/public/ltp/renewal',
    hrefLabel: 'LTP Renewal',
  },
  {
    id: 'documents',
    question: 'What documents will I need?',
    answer: ['The list depends on the permission type and on what is being registered. The registration forms show the documents they need before you submit. The document checklist for applications is available as a download.'],
    href: '/public/downloads#application-guidelines',
    hrefLabel: 'Downloads',
  },
  {
    id: 'demo',
    question: 'Is this an official government portal?',
    answer: ['No. BBAS is a demonstration system. The people, organisations, numbers and announcements you see are fictional, and nothing filed here has any legal effect.'],
  },
  {
    id: 'help',
    question: 'Who do I contact if something goes wrong?',
    answer: ['The Helpdesk and Contact pages list the demonstration contact routes. For a real deployment these would carry the authority’s own details.'],
    href: '/public/helpdesk',
    hrefLabel: 'Helpdesk',
  },
];

// ── Helpdesk and contact (demonstration details) ────────────────────────────

export const HELPDESK = {
  hours: [
    { day: 'Monday to Friday', time: '10:00 to 17:30' },
    { day: 'Saturday', time: '10:00 to 13:00' },
    { day: 'Sunday and public holidays', time: 'Closed' },
  ],
  topics: [
    'A file’s status, or a number that will not search',
    'Registering or renewing a developer or an LTP',
    'A document that will not upload',
    'Signing in to the BBAS workspace',
  ],
  email: 'helpdesk@bbas.example',
  phone: '000-0000-0000',
};

export const CONTACT = {
  organisation: 'BBAS — Building Permission Authority (demonstration)',
  address: ['Demonstration address', 'Not a real office', 'BBAS project team'],
  email: 'contact@bbas.example',
  phone: '000-0000-0000',
};

// ── Downloads ───────────────────────────────────────────────────────────────

export const DOWNLOAD_CATEGORIES = [
  { id: 'user-manuals', title: 'User Manuals', blurb: 'Guides to using the portal and the applicant workspace.' },
  { id: 'application-guidelines', title: 'Application Guidelines', blurb: 'Preparing and submitting a building permission application.' },
  { id: 'building-permission-information', title: 'Building Permission Information', blurb: 'How a permission is processed, and what is charged and why.' },
  { id: 'ltp-guidelines', title: 'LTP Guidelines', blurb: 'Registering, renewing and being listed as a Licensed Technical Person.' },
  { id: 'developer-guidelines', title: 'Developer Guidelines', blurb: 'Registering and renewing as a developer.' },
  { id: 'forms', title: 'Frequently Used Forms', blurb: 'Sample forms showing the fields each online form asks for.' },
  { id: 'bim-help', title: 'BIM Help', blurb: 'Preparing a BIM model that can be checked.' },
  { id: 'orders-regulations', title: 'Government Orders & Regulations', blurb: 'Orders and regulations the authority publishes.' },
] as const;

export type DownloadCategoryId = (typeof DOWNLOAD_CATEGORIES)[number]['id'];

/**
 * What a download is.
 *
 *   LIVE         built when it is requested, from the database (a register, a checklist).
 *   DEMO_GUIDE   written for this demonstration and generated as a PDF.
 *   SAMPLE_FORM  a PDF listing the fields of one of the portal's online forms.
 *   PLACEHOLDER  stands where an official document would go. The file says so on every page.
 */
export type DownloadKind = 'LIVE' | 'DEMO_GUIDE' | 'SAMPLE_FORM' | 'PLACEHOLDER';

export type DownloadItem = {
  slug: string;
  category: DownloadCategoryId;
  title: string;
  summary: string;
  kind: DownloadKind;
  format: 'PDF' | 'CSV';
};

export const DOWNLOAD_KIND_LABEL: Record<DownloadKind, string> = {
  LIVE: 'Live data export',
  DEMO_GUIDE: 'Demo guide',
  SAMPLE_FORM: 'Sample form (demo)',
  PLACEHOLDER: 'Demo document / placeholder',
};

export const DOWNLOAD_ITEMS: readonly DownloadItem[] = [
  { slug: 'portal-user-manual', category: 'user-manuals', title: 'Using the public portal', summary: 'A short guide to the public services: searching, registering, renewing and downloading.', kind: 'DEMO_GUIDE', format: 'PDF' },
  { slug: 'applicant-workspace-manual-placeholder', category: 'user-manuals', title: 'Applicant (LTP) workspace manual', summary: 'A placeholder for the full user manual for LTPs. No official manual has been supplied.', kind: 'PLACEHOLDER', format: 'PDF' },
  { slug: 'how-to-apply-guide', category: 'application-guidelines', title: 'How to apply — a walkthrough', summary: 'Preparing and submitting a building permission application, in order.', kind: 'DEMO_GUIDE', format: 'PDF' },
  { slug: 'document-checklist', category: 'application-guidelines', title: 'Document checklist for building permission', summary: 'The document types configured in BBAS and when each is required, as a spreadsheet.', kind: 'LIVE', format: 'CSV' },
  { slug: 'building-permission-process', category: 'building-permission-information', title: 'The building permission process at a glance', summary: 'From preparation to permission and after, as this demonstration models it.', kind: 'DEMO_GUIDE', format: 'PDF' },
  { slug: 'fees-and-payment-information', category: 'building-permission-information', title: 'Fees and payment in this demonstration', summary: 'How a fee demand is raised and paid here, and what “demo payment” means. No fee amounts are stated.', kind: 'DEMO_GUIDE', format: 'PDF' },
  { slug: 'ltp-registration-guide', category: 'ltp-guidelines', title: 'LTP registration and renewal — guide', summary: 'What the LTP registration and renewal forms ask for, and what happens after you submit.', kind: 'DEMO_GUIDE', format: 'PDF' },
  { slug: 'registered-ltps', category: 'ltp-guidelines', title: 'Register of Licensed Technical Persons', summary: 'The public LTP register: number, name, type, status and validity.', kind: 'LIVE', format: 'CSV' },
  { slug: 'ltp-qualification-placeholder', category: 'ltp-guidelines', title: 'Qualification of Licensed Technical Personnel', summary: 'A placeholder for the qualification requirements for LTP registration.', kind: 'PLACEHOLDER', format: 'PDF' },
  { slug: 'developer-registration-guide', category: 'developer-guidelines', title: 'Developer registration and renewal — guide', summary: 'What the developer registration and renewal forms ask for, and what happens after you submit.', kind: 'DEMO_GUIDE', format: 'PDF' },
  { slug: 'registered-developers', category: 'developer-guidelines', title: 'Register of developers', summary: 'The public developer register: number, name, type, status and validity.', kind: 'LIVE', format: 'CSV' },
  { slug: 'form-developer-registration', category: 'forms', title: 'Developer registration — sample form', summary: 'The fields of the online developer registration form.', kind: 'SAMPLE_FORM', format: 'PDF' },
  { slug: 'form-ltp-registration', category: 'forms', title: 'LTP registration — sample form', summary: 'The fields of the online LTP registration form.', kind: 'SAMPLE_FORM', format: 'PDF' },
  { slug: 'form-renewal', category: 'forms', title: 'Renewal — sample form', summary: 'The fields of the developer and LTP renewal forms.', kind: 'SAMPLE_FORM', format: 'PDF' },
  { slug: 'form-consent', category: 'forms', title: 'Consent — sample form', summary: 'What the demonstration consent links ask for.', kind: 'SAMPLE_FORM', format: 'PDF' },
  { slug: 'bim-modelling-guide', category: 'bim-help', title: 'BIM modelling conventions', summary: 'Naming, levels, units and layers for a model that can be checked.', kind: 'DEMO_GUIDE', format: 'PDF' },
  { slug: 'bim-dos-and-donts', category: 'bim-help', title: 'BIM do’s and don’ts', summary: 'Common mistakes in a submitted model, and the fix for each.', kind: 'DEMO_GUIDE', format: 'PDF' },
  { slug: 'bim-help-manual-placeholder', category: 'bim-help', title: 'BIM help manual', summary: 'A placeholder for the BIM help manual and model-builder plug-in guide.', kind: 'PLACEHOLDER', format: 'PDF' },
  { slug: 'go-building-permission-placeholder', category: 'orders-regulations', title: 'Government order on building permission', summary: 'A placeholder for the authority’s governing order. No official order has been supplied.', kind: 'PLACEHOLDER', format: 'PDF' },
  { slug: 'go-fee-schedule-placeholder', category: 'orders-regulations', title: 'Order on fees and charges', summary: 'A placeholder for the fee order. Fees in this demonstration come from the configured fee schedule.', kind: 'PLACEHOLDER', format: 'PDF' },
  { slug: 'zoning-regulations-placeholder', category: 'orders-regulations', title: 'Zoning plan and regulations', summary: 'A placeholder for the zoning plan and development regulations.', kind: 'PLACEHOLDER', format: 'PDF' },
];

export const downloadBySlug = (slug: string) => DOWNLOAD_ITEMS.find((d) => d.slug === slug);

/** The body of each generated PDF. Plain paragraphs and bullets — the PDF and the page both render these. */
export type GuideSection = { heading: string; paragraphs?: string[]; bullets?: string[] };

const form = (title: string, intro: string, sections: GuideSection[]) => ({ title, intro, sections });

export const DEMO_GUIDES: Record<string, { title: string; intro: string; sections: GuideSection[] }> = {
  'portal-user-manual': {
    title: 'Using the public portal',
    intro: 'A short guide to what the public pages of BBAS offer. It describes this demonstration only.',
    sections: [
      { heading: 'Follow a file', bullets: ['Open “Search your application status” and enter an application or proceeding number. Add the applicant’s mobile digits to see the applicant’s name.', 'Open “Pay your fees here” to see the fee demand and payment history, and to make a demonstration payment.'] },
      { heading: 'Developers', bullets: ['“Developer Registration” files a new registration with its documents.', '“Developer Registration Status” follows it by registration or reference number.', '“Developer Renewal” renews a registration that is due or has lapsed.', '“List of Registered Developer” is the public register.'] },
      { heading: 'Licensed Technical Persons', bullets: ['“New Registration” files an LTP registration.', '“LTP Renewal” renews one, and “Payment and Renewal” shows the renewal’s fee and status.', '“List of Registered LTPs” and “LTP View” show the public register and a profile.'] },
      { heading: 'Signing in', paragraphs: ['LTPs and officers sign in through “Login”. The public pages never need a login and never show anything an applicant or officer would see after signing in.'] },
    ],
  },
  'how-to-apply-guide': {
    title: 'How to apply — a walkthrough',
    intro: 'A demonstration walkthrough of the application journey. It is not an official procedure.',
    sections: [
      { heading: '1. Get a registered LTP', paragraphs: ['Applications are filed by a Licensed Technical Person. Check the LTP register to confirm your LTP is registered and in force.'] },
      { heading: '2. Prepare the file', bullets: ['Enter the applicant, plot and building details.', 'Attach the drawings or the BIM model.', 'Answer the application checklist and attach the required documents.'] },
      { heading: '3. Scrutiny and fee', bullets: ['The drawing is checked against the rules.', 'The system calculates the fee and raises a demand.', 'Pay the demand from the workspace, or make a demonstration payment from the public portal.'] },
      { heading: '4. Submit and follow', bullets: ['Submit the file. It goes to the authority’s desks in turn.', 'If a shortfall is raised, answer it from the workspace.', 'Follow the public status at any time with the application number.'] },
      { heading: '5. Permission and after', paragraphs: ['When approved, a Building Permission Order is issued with a proceeding number. The public status page and the verification page confirm it.'] },
    ],
  },
  'building-permission-process': {
    title: 'The building permission process at a glance',
    intro: 'How a building permission moves through this demonstration. Not an official description of any authority’s procedure.',
    sections: [
      { heading: 'Stages', bullets: ['Preparation by the LTP: details, drawings or BIM model, documents.', 'Scrutiny: the drawing is checked against the rules; a failed check is corrected and re-run.', 'Fee: a demand is raised from the configured fee schedule and paid.', 'Department review: the file passes through the desks in turn, and may return to the applicant as a shortfall.', 'Decision: the file is approved or not approved.', 'Permission: a Building Permission Order is issued with a proceeding number and a validity.'] },
      { heading: 'After permission', bullets: ['Commencement of work is recorded against the permission.', 'Occupancy is applied for after completion.', 'A permission can be revoked by a decided revocation proceeding; the earlier approval stays on the record.'] },
      { heading: 'What the public can see', paragraphs: ['The public status page shows a file’s stage, shortfall status, payment status and issued order. It never shows officers’ remarks or internal notes.'] },
    ],
  },
  'fees-and-payment-information': {
    title: 'Fees and payment in this demonstration',
    intro: 'How fees work in BBAS. No fee amount is stated here: amounts come from the configured fee schedule.',
    sections: [
      { heading: 'Where a fee comes from', paragraphs: ['When the documents are complete the system calculates the fee from the fee schedule configured for the permission type and raises a demand. The calculation is frozen on the demand.'] },
      { heading: 'Paying', bullets: ['The applicant pays from the workspace’s Payments tab.', 'The public “Pay your fees here” page shows the demand and offers a demonstration payment.', 'Every online payment in this demonstration goes through a demonstration gateway. No real transaction is ever processed and every receipt is marked as a demonstration.'] },
      { heading: 'Renewal fees', paragraphs: ['Developer and LTP renewals show a demonstration fee taken from system settings, to show the shape of the flow. BBAS has no fee engine for registrations, so that fee is a labelled demonstration record, not a published fee.'] },
    ],
  },
  'ltp-registration-guide': {
    title: 'LTP registration and renewal — guide',
    intro: 'What the online LTP forms ask for and what follows. Demonstration guidance only.',
    sections: [
      { heading: 'New registration', bullets: ['Professional information: LTP type, name, qualification, experience, organisation.', 'Contact: mobile number and email address.', 'Professional registration: licence number, registration body, licence validity.', 'Address, then the supporting documents, then the declaration and consent.'] },
      { heading: 'After you submit', bullets: ['You receive a reference number (PRA/…).', 'The authority takes the application up, checks each document and decides it.', 'On approval a registration number is issued and the LTP appears on the public register.'] },
      { heading: 'Renewal', bullets: ['Give the registration number and the last four digits of the registered mobile.', 'A renewal opens when the renewal window begins, and can also be filed after a registration lapses.', 'Give the licence’s renewed validity and consent afresh; add a supporting document if you wish.', 'A demonstration fee is shown and can be paid with the renewal or later from “Payment and Renewal”.'] },
    ],
  },
  'developer-registration-guide': {
    title: 'Developer registration and renewal — guide',
    intro: 'What the online developer forms ask for and what follows. Demonstration guidance only.',
    sections: [
      { heading: 'New registration', bullets: ['Developer: type, name, organisation, authorised person and designation.', 'Contact: address, district, PIN code, mobile and email.', 'Registration information: PAN, GSTIN, incorporation number and date, RERA number, experience and projects completed.', 'Supporting documents, which depend on the developer type.'] },
      { heading: 'After you submit', bullets: ['You receive a reference number (DRA/…).', 'The authority takes the application up, may raise a shortfall, verifies it and decides it.', 'On approval a registration number (DEV/…) is issued with its validity.'] },
      { heading: 'Renewal', bullets: ['Give the registration number and the last four digits of the registered mobile.', 'The registration’s particulars and documents carry forward; add a supporting document if you wish.', 'A demonstration fee is shown and can be paid with the renewal or later from the renewal page.'] },
    ],
  },
  'form-developer-registration': form('Developer registration — sample form', 'The fields of the online form, for reference. File the registration online; this sheet is not accepted.', [
    { heading: 'Developer', bullets: ['Developer type *', 'Developer name *', 'Organisation (for a firm or company) *', 'Authorised person *', 'Designation'] },
    { heading: 'Contact', bullets: ['Address *', 'District', 'PIN code', 'Mobile number *', 'Email address *'] },
    { heading: 'Registration information', bullets: ['PAN *', 'GSTIN (if any)', 'Incorporation / registration number', 'Incorporation date', 'RERA number', 'Years of experience', 'Projects completed', 'Other registration information'] },
    { heading: 'Documents', bullets: ['PAN card *', 'Proof of address *', 'Proof of constitution and authorisation of the signatory (firms and companies) *', 'GST certificate (if a GSTIN is given)', 'Experience and RERA certificates, if any'] },
  ]),
  'form-ltp-registration': form('LTP registration — sample form', 'The fields of the online form, for reference. File the registration online; this sheet is not accepted.', [
    { heading: 'Professional information', bullets: ['LTP type *', 'Name *', 'Qualification *', 'Years of experience', 'Organisation'] },
    { heading: 'Contact', bullets: ['Mobile number *', 'Email address *'] },
    { heading: 'Professional registration', bullets: ['Licence number *', 'Registration body *', 'Licence valid from', 'Licence valid to *'] },
    { heading: 'Address', bullets: ['Address *', 'District', 'PIN code'] },
    { heading: 'Supporting documents', bullets: ['Licence certificate *', 'Qualification certificate *', 'Identity proof *', 'Address proof *', 'Signed consent *'] },
    { heading: 'Declaration', bullets: ['Consent to the particulars being entered in the register and verified *'] },
  ]),
  'form-renewal': form('Renewal — sample form', 'The fields of the online renewal forms, for reference.', [
    { heading: 'Find the registration', bullets: ['Registration number *', 'Last four digits of the registered mobile *'] },
    { heading: 'Renewal details', bullets: ['Developer: remarks; supporting document (optional)', 'LTP: licence valid to (renewed) *; consent *; remarks; supporting document (optional)'] },
    { heading: 'Fee', bullets: ['Demonstration fee shown from system settings', 'Payment method (demonstration)'] },
  ]),
  'form-consent': form('Consent — sample form', 'What the demonstration consent links ask for.', [
    { heading: 'Consent link', bullets: ['Registration number (developer, LTP) or name (TPA) *', 'Application number (optional)', 'Accept or Decline'] },
    { heading: 'Note', paragraphs: ['In this demonstration the answer is acknowledged on screen and is not stored.'] },
  ]),
  'bim-modelling-guide': {
    title: 'BIM modelling conventions',
    intro: 'Demonstration conventions for a model that can be checked. Not an official specification.',
    sections: [
      { heading: 'Levels and units', bullets: ['Name every level, from the lowest basement to the roof, in one consistent scheme.', 'Use one unit system for the whole model and state it.'] },
      { heading: 'Plot and setbacks', bullets: ['Put the plot boundary on its own layer.', 'Draw the building footprint so it can be measured against the boundary.'] },
      { heading: 'Elements', bullets: ['Model walls, slabs, stairs and openings as their own element types, not as generic shapes.', 'Give each space a name and a use.'] },
    ],
  },
  'bim-dos-and-donts': {
    title: 'BIM do’s and don’ts',
    intro: 'Common mistakes in a submitted model. Demonstration guidance only.',
    sections: [
      { heading: 'Do', bullets: ['Do keep the model at real-world scale and location.', 'Do name levels and spaces.', 'Do purge unused elements before submitting.'] },
      { heading: 'Don’t', bullets: ['Don’t mix units.', 'Don’t leave the plot boundary out of the model.', 'Don’t flatten the model to lines only; the checks need the objects.'] },
    ],
  },
};

export const PLACEHOLDER_NOTE =
  'This is a demonstration placeholder. It stands where an official document would be published and has no legal or regulatory effect. No official document of this kind has been supplied to this project.';
