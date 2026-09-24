/**
 * The filing wizard, as data.
 *
 * Isomorphic — the client renders from this, the server validates against it,
 * and the submit guard decides completeness from it. One list, so a step
 * cannot exist on screen without a schema behind it, and a schema cannot be
 * silently skipped at submission.
 *
 * `entity` says which table a step writes to. Several steps share one table:
 * "Applicant" and "Owner" are both `applicants`, and "Property", "Location"
 * and "Survey/Plot" are all `property_details`. That is why the wizard builds
 * those rows progressively rather than in one write.
 */

export const STEP_KEYS = [
  'applicant',
  'owner',
  'property',
  'location',
  'survey',
  'development',
  'building',
  'ltp',
  'review',
  'submit',
] as const;

export type StepKey = (typeof STEP_KEYS)[number];

export type WizardStep = {
  key: StepKey;
  label: string;
  /** Shown under the heading. Says what the step is for, not what it is called. */
  description: string;
  /** Which record the step's values land in. `none` = no persisted fields. */
  entity: 'applicant' | 'property' | 'building' | 'application' | 'none';
  /**
   * False for the two steps that capture nothing: Review reads back what has
   * been entered, Submit confirms and files. Neither has a schema, and neither
   * is required to be "completed" before submission — reaching Submit is the
   * completion.
   */
  capturesData: boolean;
};

export const WIZARD_STEPS: readonly WizardStep[] = [
  {
    key: 'applicant',
    label: 'Applicant details',
    description: 'The person applying for permission.',
    entity: 'applicant',
    capturesData: true,
  },
  {
    key: 'owner',
    label: 'Owner details',
    description: 'The owner of the land, where that is not the applicant.',
    entity: 'applicant',
    capturesData: true,
  },
  {
    key: 'property',
    label: 'Property details',
    description: 'Where the property sits administratively.',
    entity: 'property',
    capturesData: true,
  },
  {
    key: 'location',
    label: 'Location',
    description: 'Street address, zone and site boundaries.',
    entity: 'property',
    capturesData: true,
  },
  {
    key: 'survey',
    label: 'Survey and plot',
    description: 'Survey numbers, plot extent and the abutting road.',
    entity: 'property',
    capturesData: true,
  },
  {
    key: 'development',
    label: 'Development',
    description: 'What is proposed to be built, and of what kind.',
    entity: 'building',
    capturesData: true,
  },
  {
    key: 'building',
    label: 'Building',
    description: 'Areas, coverage and setbacks.',
    entity: 'building',
    capturesData: true,
  },
  {
    key: 'ltp',
    label: 'Licensed technical person',
    description: 'Your licence particulars and declaration.',
    entity: 'application',
    capturesData: true,
  },
  {
    key: 'review',
    label: 'Review',
    description: 'Everything you have entered, in one place.',
    entity: 'none',
    capturesData: false,
  },
  {
    key: 'submit',
    label: 'Submit',
    description: 'File the application and start the approval process.',
    entity: 'none',
    capturesData: false,
  },
] as const;

/** Step keys that must have passed their schema before an application may be filed. */
export const REQUIRED_STEP_KEYS: StepKey[] = WIZARD_STEPS.filter((s) => s.capturesData).map(
  (s) => s.key
);

export const stepIndex = (key: StepKey): number => WIZARD_STEPS.findIndex((s) => s.key === key);

export function stepAt(index: number): WizardStep | undefined {
  return WIZARD_STEPS[index];
}

export function stepByKey(key: string): WizardStep | undefined {
  return WIZARD_STEPS.find((s) => s.key === key);
}

/**
 * Which statuses still allow the LTP to edit the file.
 *
 * Only DRAFT today. Phase 3 onward adds the states where a returned
 * application becomes editable again; keeping the answer in one exported
 * predicate means that change lands in one place rather than in every route
 * that writes.
 */
const EDITABLE_STATUSES = new Set<string>(['DRAFT']);

export const isEditableStatus = (status: string): boolean => EDITABLE_STATUSES.has(status);

/** Statuses from which nothing further happens. Mirrors TERMINAL_STATUSES. */
export const isSubmittedStatus = (status: string): boolean => status !== 'DRAFT';

/**
 * TEMPORARY (demo): whether Next refuses to leave a step until it validates.
 *
 * Off: Next saves the step properly when it validates and, when it does not,
 * keeps what was typed as a draft (`application_drafts.scratch`) and moves on
 * anyway — every step can be walked through to Review and Submit with any
 * field left blank. Required-field markers are hidden to match.
 *
 * Nothing else is relaxed. The server still validates each step before
 * writing it to the real tables, and Submit still refuses to file an
 * application with anything missing, listing what is. Set back to `true` to
 * restore the original behaviour.
 */
export const WIZARD_REQUIRES_FIELDS_TO_ADVANCE = false;
