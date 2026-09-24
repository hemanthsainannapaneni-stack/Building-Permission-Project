import type { Capability } from '@/lib/constants';
import { CAPABILITIES as C } from '@/lib/constants';

/**
 * The application detail page's tabs, as data.
 *
 * All thirteen are declared from the start and each is enabled by the phase that
 * builds it — Overview and Details in Phase 2, Drawings and Scrutiny in
 * Phase 3. That is a deliberate choice over adding tabs phase by phase:
 *
 *  · The shape of the record is visible from the start. Someone looking at an
 *    application can see that drawings, fees and shortfalls are part of it,
 *    which is true, rather than discovering later that the page grew.
 *  · Each later phase enables its tab by flipping `available` and pointing
 *    `panel` at a component. No routing, no layout and no navigation changes.
 *  · A disabled tab NAMES ITS PHASE. "Documents — Phase 4" is information; a
 *    greyed-out tab with no explanation is a bug report waiting to happen.
 *
 * `capabilities` filters tabs a role may not see at all — an LTP has no
 * DOCUMENT_VERIFY, but the Documents tab is theirs to use, so the capability
 * listed is the viewing one.
 */

export type TabKey =
  | 'overview'
  | 'details'
  | 'checklist'
  | 'others'
  | 'drawings'
  | 'bim'
  | 'scrutiny'
  | 'inspection'
  | 'nocs'
  | 'documents'
  | 'fees'
  | 'payments'
  | 'workflow'
  | 'shortfalls'
  | 'proceedings'
  | 'professional'
  | 'commencement'
  | 'occupancy'
  | 'communications'
  | 'audit';

export type TabDef = {
  key: TabKey;
  label: string;
  /** False until the phase that builds it lands. */
  available: boolean;
  /** The phase that delivers it. Empty when already delivered. */
  phase: string;
  /** What it will hold — shown on the placeholder panel. */
  description: string;
  /** Any one of these grants visibility. Empty = everyone who can see the file. */
  capabilities?: Capability[];
};

export const APPLICATION_TABS: readonly TabDef[] = [
  {
    key: 'overview',
    label: 'Overview',
    available: true,
    phase: '',
    description: 'Summary, progress and recent activity.',
  },
  {
    key: 'details',
    label: 'Application details',
    available: true,
    phase: '',
    description: 'Every particular entered on the application.',
  },
  {
    key: 'checklist',
    label: 'Checklist',
    available: true,
    phase: '',
    description:
      'The 19-point application checklist — the applicant’s answers, each desk’s verification, and the full history of both.',
    capabilities: [C.CHECKLIST_VIEW],
  },
  {
    key: 'others',
    label: 'Others',
    available: true,
    phase: '',
    description:
      'Mortgage, car insurance, solar, rainwater harvesting, greening and the special remarks — the undertakings that travel with the permission.',
  },
  {
    key: 'drawings',
    label: 'Drawings',
    available: true,
    phase: '',
    description:
      'Upload the building drawing and see every version. A correction is always a new version — nothing is overwritten.',
    capabilities: [C.DRAWING_VIEW],
  },
  {
    key: 'bim',
    label: 'BIM',
    available: true,
    phase: '',
    description:
      'The building information model submitted with the drawings — the IFC files, what the model itself says, how it agrees with the application, and the department’s review.',
    capabilities: [C.DRAWING_VIEW],
  },
  {
    key: 'scrutiny',
    label: 'Scrutiny',
    available: true,
    phase: '',
    description:
      'The automated check of the drawing against the building rules, and the issues it reports.',
    capabilities: [C.SCRUTINY_VIEW],
  },
  {
    key: 'inspection',
    label: 'Site Inspection',
    available: true,
    phase: '',
    description:
      'The TPA’s site visit — the 27 questions (provisional demo wording), geo-tagged photographs, the recommendation and the demo signature.',
    capabilities: [C.SITE_INSPECTION_VIEW],
  },
  {
    key: 'nocs',
    label: 'NOCs',
    available: true,
    phase: '',
    description:
      'No-objection certificates from external authorities — Fire today — with what is required, received, verified and still pending.',
    capabilities: [C.NOC_VIEW],
  },
  {
    key: 'documents',
    label: 'Documents',
    available: true,
    phase: '',
    description:
      'The documents required for this application, which are still outstanding, and their verification status.',
    capabilities: [C.DOCUMENT_VIEW],
  },
  {
    key: 'fees',
    label: 'Fees',
    available: true,
    phase: '',
    description: 'The demand raised against this application, itemised by head of account.',
    capabilities: [C.FEE_VIEW],
  },
  {
    key: 'payments',
    label: 'Payments',
    available: true,
    phase: '',
    description:
      'What is payable, what has been paid, every attempt at the gateway and the receipts issued.',
    capabilities: [C.PAYMENT_VIEW],
  },
  {
    key: 'workflow',
    label: 'Workflow',
    available: true,
    phase: '',
    description:
      'Which desk the file is at, who has acted on it, and what each of them did. The full movement history.',
    capabilities: [C.WORKFLOW_VIEW],
  },
  {
    key: 'shortfalls',
    label: 'Shortfalls',
    available: true,
    phase: '',
    description:
      'Anything the department has asked for, your response, and whether it was accepted.',
    capabilities: [C.SHORTFALL_VIEW],
  },
  {
    key: 'proceedings',
    label: 'Proceedings',
    available: true,
    phase: '',
    description:
      'Show cause notices, revocation proceedings and the documents this file has sent through Outward. Separate from shortfalls.',
    capabilities: [C.SHOW_CAUSE_VIEW],
  },
  {
    key: 'professional',
    label: 'Technical Professional',
    available: true,
    phase: '',
    description:
      'Who holds this file and may submit drawings, everyone who has held it, and any request to change the professional.',
    capabilities: [C.PROFESSIONAL_CHANGE_VIEW],
  },
  {
    key: 'commencement',
    label: 'Work Initiated',
    available: true,
    phase: '',
    description:
      'After approval: the building permission order, the approved plan and scrutiny report, and the notice that work has commenced on site.',
    capabilities: [C.COMMENCEMENT_VIEW],
  },
  {
    key: 'occupancy',
    label: 'Occupancy',
    available: true,
    phase: '',
    description:
      'Completion intimation, the final inspection, the as-built review against the approved plan, the recommendation and decision, and the occupancy certificate.',
    capabilities: [C.OCCUPANCY_VIEW],
  },
  {
    key: 'communications',
    label: 'Communications',
    available: false,
    phase: 'Phase 9',
    description: 'Every notification sent about this application, and whether it was delivered.',
  },
  {
    key: 'audit',
    label: 'Audit',
    available: true,
    phase: '',
    description:
      'The tamper-evident record of every change: who, what, when, and the value before and after.',
    capabilities: [C.AUDIT_VIEW],
  },
] as const;

/** Tabs this role may see. Availability is separate — see the note above. */
export function visibleTabs(capabilities: string[]): TabDef[] {
  return APPLICATION_TABS.filter(
    (tab) => !tab.capabilities?.length || tab.capabilities.some((c) => capabilities.includes(c))
  );
}

export const isTabKey = (value: string): value is TabKey =>
  APPLICATION_TABS.some((tab) => tab.key === value);
