'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Pencil,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { WIZARD_STEPS } from '@/lib/application-steps';
import type { ApplicationMeta, WizardState } from '../types';

/**
 * The review step.
 *
 * Shows everything back, grouped by the step it came from, with an Edit link
 * on each group. Two decisions worth naming:
 *
 *  · Problems are listed AT THE TOP and repeated on the group they belong to.
 *    The list tells you how much is wrong; the inline marker tells you where.
 *    Either alone leaves the user hunting.
 *
 *  · The problems come from the SERVER re-validating the persisted rows, not
 *    from the client re-running the schemas over what it has in memory. What
 *    is about to be filed is what is in the database, so that is what gets
 *    checked.
 *
 * Continuing to Submit is allowed even with problems outstanding — the Submit
 * step refuses, and blocking Next here would leave someone stuck on a screen
 * with no explanation of what happens next.
 */
export function ReviewStep({
  state,
  meta,
  onEditStep,
  onBack,
  onNext,
}: {
  state: WizardState;
  meta: ApplicationMeta;
  onEditStep: (key: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { steps, problems, application } = state;

  const problemsByStep = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const problem of problems) {
      const stepKey = problem.path.split('.')[0] ?? '';
      // The message already carries the step label — strip it, since the
      // group heading right above says the same thing.
      const message = problem.message.replace(/^[^:]+:\s*/, '');
      map.set(stepKey, [...(map.get(stepKey) ?? []), message]);
    }
    return map;
  }, [problems]);

  const zoneName = meta.zones.find((z) => z.id === application.zoneId)?.name ?? '';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Review</CardTitle>
          <CardDescription>
            Check every particular before filing. You can still change anything on this screen.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {problems.length === 0 ? (
            <div className="flex items-start gap-2 rounded border border-success/25 bg-success-bg px-3 py-2.5">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
              <p className="text-small text-success">
                Everything needed to file is present. Continue to submit the application.
              </p>
            </div>
          ) : (
            <div className="rounded border border-warning/30 bg-warning-bg px-3 py-2.5">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="min-w-0">
                  <p className="text-small font-medium text-warning">
                    {problems.length} {problems.length === 1 ? 'item needs' : 'items need'} attention
                    before this can be filed
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {problems.map((problem) => (
                      <li key={problem.path} className="text-caption text-warning">
                        • {problem.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/*
        ── The 19-point checklist ───────────────────────────────────────
        The checklist is answered on the application's own Checklist tab
        rather than as a wizard step, and this card is the bridge.

        A step of its own was the obvious alternative and is the wrong shape:
        the checklist is answered AGAIN after filing — whenever a desk returns
        the file — while every wizard step is by definition something you do
        once, before the file exists. Making it a step would have meant either
        a step that reopens after submission, or two different screens for the
        same nineteen questions.

        It is left OUT of the filing preconditions on purpose. Nothing in the
        BBAS manuals supplied says an unanswered checklist blocks filing, and
        the wording is provisional besides — refusing to accept an application
        on the strength of a sentence this system wrote itself would be the
        wrong way round.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-4 text-text-muted" aria-hidden />
            Application checklist
          </CardTitle>
          <CardDescription>
            The 19-point checklist the department verifies this application against. You can answer
            it now, and again if the file is returned to you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/applications/${application.id}?tab=checklist`}>
              Open the checklist
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {WIZARD_STEPS.filter((s) => s.capturesData).map((step) => {
        const issues = problemsByStep.get(step.key) ?? [];
        const values = steps[step.key] ?? {};

        return (
          <Card key={step.key}>
            <CardHeader className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  {step.label}
                  {issues.length > 0 && (
                    <TriangleAlert className="size-4 text-warning" aria-label="Needs attention" />
                  )}
                </CardTitle>
                {issues.length > 0 && (
                  <CardDescription className="text-warning">
                    {issues.join(' · ')}
                  </CardDescription>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => onEditStep(step.key)}>
                <Pencil className="size-3.5" />
                Edit
              </Button>
            </CardHeader>

            <CardContent>
              <SummaryGrid stepKey={step.key} values={values} zoneName={zoneName} meta={meta} />
            </CardContent>
          </Card>
        );
      })}

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <Button variant="primary" onClick={onNext}>
          Continue to submit
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Rendering values back
// ═══════════════════════════════════════════════════════════════════════════

/** Labels for the review screen. Field names are not a user interface. */
const LABELS: Record<string, string> = {
  name: 'Full name',
  fatherName: "Father's / husband's name",
  email: 'Email',
  phone: 'Mobile',
  aadhaarLast4: 'Aadhaar (last 4)',
  panMasked: 'PAN',
  address: 'Address',
  ownerSameAsApplicant: 'Owner is the applicant',
  ownerName: "Owner's name",
  ownerPhone: "Owner's mobile",
  ownerAddress: "Owner's address",
  district: 'District',
  mandal: 'Mandal',
  village: 'Village',
  localityName: 'Locality',
  wardNo: 'Ward',
  zoneId: 'Zone',
  doorNo: 'Door number',
  streetName: 'Street',
  pincode: 'PIN code',
  latitude: 'Latitude',
  longitude: 'Longitude',
  boundaryNorth: 'North',
  boundarySouth: 'South',
  boundaryEast: 'East',
  boundaryWest: 'West',
  surveyNumbers: 'Survey number(s)',
  plotNo: 'Plot number',
  layoutName: 'Layout',
  lpNumber: 'LP number',
  plotAreaSqm: 'Plot area (sq m)',
  roadWidthM: 'Road width (m)',
  landUseZone: 'Land use',
  tenureType: 'Tenure',
  buildingUse: 'Building use',
  buildingSubUse: 'Sub-use',
  occupancyType: 'Occupancy',
  structureType: 'Structure',
  numFloors: 'Floors',
  numBasements: 'Basements',
  numDwellingUnits: 'Dwelling units',
  buildingHeightM: 'Height (m)',
  builtUpAreaSqm: 'Built-up area (sq m)',
  floorAreaSqm: 'Floor area (sq m)',
  coverageAreaSqm: 'Ground coverage (sq m)',
  parkingAreaSqm: 'Parking area (sq m)',
  setbackFrontM: 'Front setback (m)',
  setbackRearM: 'Rear setback (m)',
  setbackLeftM: 'Left setback (m)',
  setbackRightM: 'Right setback (m)',
  declarationAccepted: 'Declaration',
  remarks: 'Remarks',
};

/** Master-data categories, so a stored code renders as its label. */
const CODE_FIELDS: Record<string, string> = {
  landUseZone: 'LAND_USE',
  tenureType: 'TENURE',
  buildingUse: 'BUILDING_USE',
  occupancyType: 'OCCUPANCY',
  structureType: 'STRUCTURE_TYPE',
};

function SummaryGrid({
  stepKey,
  values,
  zoneName,
  meta,
}: {
  stepKey: string;
  values: Record<string, unknown>;
  zoneName: string;
  meta: ApplicationMeta;
}) {
  // The owner step collapses to one line when the owner is the applicant —
  // showing three empty rows would imply something is missing.
  if (stepKey === 'owner' && values.ownerSameAsApplicant) {
    return <p className="text-small text-text-muted">The applicant is the owner of the land.</p>;
  }

  const entries = Object.entries(values).filter(([key]) => key !== 'ownerSameAsApplicant');

  return (
    <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-caption uppercase tracking-wide text-text-muted">
            {LABELS[key] ?? key}
          </dt>
          <dd className="mt-0.5 break-words text-small text-text">
            {display(key, value, zoneName, meta)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function display(
  key: string,
  value: unknown,
  zoneName: string,
  meta: ApplicationMeta
): React.ReactNode {
  if (key === 'zoneId') {
    return zoneName || <NotEntered />;
  }

  const category = CODE_FIELDS[key];
  if (category && typeof value === 'string' && value) {
    return meta.master[category]?.find((o) => o.code === value)?.label ?? value;
  }

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined || value === '') return <NotEntered />;
  if (typeof value === 'number') {
    return <span className="tabular-nums">{Number.isInteger(value) ? value : value.toFixed(2)}</span>;
  }

  return String(value);
}

/**
 * Blank means "not answered", and says so.
 *
 * A dash reads as a value; an empty cell reads as a rendering bug. On a review
 * screen the difference decides whether someone goes back and fills it in.
 */
function NotEntered() {
  return <span className="italic text-text-subtle">Not entered</span>;
}
