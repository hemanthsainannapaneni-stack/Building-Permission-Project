'use client';

import * as React from 'react';
import { Controller, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DataStepKey } from '@/lib/schemas/applications';
import { WIZARD_REQUIRES_FIELDS_TO_ADVANCE } from '@/lib/application-steps';
import type { ApplicationMeta } from '../types';
import { api } from '../api';

/** The required marker, shown only while Next enforces it — see WIZARD_REQUIRES_FIELDS_TO_ADVANCE. */
const marked = (required?: boolean) => WIZARD_REQUIRES_FIELDS_TO_ADVANCE && Boolean(required);

/**
 * The fields of every wizard step.
 *
 * Kept together rather than one file each because they are variations on one
 * thing — a labelled control bound to a react-hook-form field — and splitting
 * eight near-identical modules apart makes the differences between the steps
 * harder to see, not easier.
 *
 * Every step's validation lives in src/lib/schemas/applications.ts, not here.
 * These components decide LAYOUT and nothing else, which is why a required
 * field is marked with `required` for the reader but never enforced in the
 * markup: the schema is the single answer to "is this valid", on both sides
 * of the wire.
 */

type Form = UseFormReturn<FieldValues>;

export function StepFields({
  stepKey,
  form,
  meta,
  applicantName,
}: {
  stepKey: DataStepKey;
  form: Form;
  meta: ApplicationMeta;
  /** Shown on the owner step, so "same as applicant" names a person. */
  applicantName?: string;
}) {
  switch (stepKey) {
    case 'applicant':
      return <ApplicantFields form={form} />;
    case 'owner':
      return <OwnerFields form={form} applicantName={applicantName} />;
    case 'property':
      return <PropertyFields form={form} />;
    case 'location':
      return <LocationFields form={form} meta={meta} />;
    case 'survey':
      return <SurveyFields form={form} meta={meta} />;
    case 'development':
      return <DevelopmentFields form={form} meta={meta} />;
    case 'building':
      return <BuildingFields form={form} />;
    case 'ltp':
      return <LtpFields form={form} />;
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Field helpers
// ═══════════════════════════════════════════════════════════════════════════

const errorOf = (form: Form, name: string): string | undefined => {
  const error = form.formState.errors[name];
  return typeof error?.message === 'string' ? error.message : undefined;
};

function Text({
  form,
  name,
  label,
  hint,
  required,
  type = 'text',
  placeholder,
  autoFocus,
  className,
  inputMode,
}: {
  form: Form;
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  const error = errorOf(form, name);
  return (
    <Field label={label} htmlFor={name} error={error} hint={hint} required={marked(required)} className={className}>
      <Input
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        autoFocus={autoFocus}
        invalid={Boolean(error)}
        {...form.register(name)}
      />
    </Field>
  );
}

/**
 * A number input registered as a STRING.
 *
 * `valueAsNumber` turns an empty box into NaN, which every downstream check
 * then has to special-case. The schemas use `z.coerce.number()`, so the string
 * is converted exactly once, in the one place that also decides what an empty
 * value means.
 */
function Num({
  form,
  name,
  label,
  hint,
  required,
  step = 'any',
  min = 0,
  suffix,
  readOnly,
  className,
}: {
  form: Form;
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  step?: string;
  min?: number;
  suffix?: string;
  readOnly?: boolean;
  className?: string;
}) {
  const error = errorOf(form, name);
  return (
    <Field
      label={suffix ? `${label} (${suffix})` : label}
      htmlFor={name}
      error={error}
      hint={hint}
      required={marked(required)}
      className={className}
    >
      <Input
        type="number"
        step={step}
        min={min}
        inputMode="decimal"
        readOnly={readOnly}
        disabled={readOnly}
        invalid={Boolean(error)}
        className="tabular-nums"
        {...form.register(name)}
      />
    </Field>
  );
}

function Area({
  form,
  name,
  label,
  hint,
  required,
  rows = 3,
  placeholder,
  className,
}: {
  form: Form;
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const error = errorOf(form, name);
  return (
    <Field label={label} htmlFor={name} error={error} hint={hint} required={marked(required)} className={className}>
      <Textarea rows={rows} placeholder={placeholder} invalid={Boolean(error)} {...form.register(name)} />
    </Field>
  );
}

/**
 * A select over administrator-extensible master data.
 *
 * Falls back to a free-text input when the category has no rows. The lists are
 * seeded generically and an administrator is expected to replace them; a
 * select with nothing in it would block filing entirely, which is a worse
 * failure than accepting a typed value.
 */
function Choice({
  form,
  name,
  label,
  options,
  required,
  hint,
  placeholder = 'Choose one',
  className,
}: {
  form: Form;
  name: string;
  label: string;
  options: Array<{ code: string; label: string }>;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  className?: string;
}) {
  const error = errorOf(form, name);

  if (!options.length) {
    return (
      <Text
        form={form}
        name={name}
        label={label}
        required={required}
        hint={hint ?? 'No list has been configured — type the value.'}
        className={className}
      />
    );
  }

  return (
    <Field label={label} htmlFor={name} error={error} hint={hint} required={marked(required)} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select value={(field.value as string) || undefined} onValueChange={field.onChange}>
            <SelectTrigger id={name} invalid={Boolean(error)}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Field>
  );
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="text-caption text-text-muted sm:col-span-2">{children}</p>;
}

const grid = 'grid gap-4 sm:grid-cols-2';

const LPS_OPTIONS = [
  { code: 'INSIDE_LPS', label: 'Inside LPS' },
  { code: 'OUTSIDE_LPS', label: 'Outside LPS' },
];

const PLANNING_ZONE_OPTIONS = [
  { code: 'R1_ZONE', label: 'R1 Zone' },
  { code: 'R2_ZONE', label: 'R2 Zone' },
  { code: 'COMMERCIAL_ZONE', label: 'Commercial Zone' },
  { code: 'MIXED_USE_ZONE', label: 'Mixed Use Zone' },
  { code: 'INSTITUTIONAL_ZONE', label: 'Institutional Zone' },
  { code: 'AGRICULTURAL_ZONE', label: 'Agricultural Zone' },
  { code: 'OPEN_SPACE_ZONE', label: 'Open Space Zone' },
];

// ═══════════════════════════════════════════════════════════════════════════
// Steps
// ═══════════════════════════════════════════════════════════════════════════

function ApplicantFields({ form }: { form: Form }) {
  return (
    <div className={grid}>
      <Text form={form} name="name" label="Full name" required autoFocus />
      <Text form={form} name="fatherName" label="Father's / husband's name" />
      <Text form={form} name="phone" label="Mobile number" type="tel" inputMode="numeric" placeholder="9876543210" required />
      <Text form={form} name="email" label="Email address" type="email" hint="Used for status notifications." />
      <Text
        form={form}
        name="aadhaarLast4"
        label="Aadhaar — last 4 digits"
        inputMode="numeric"
        placeholder="1234"
        hint="Last four digits only. The full number is never stored."
      />
      <Text form={form} name="panMasked" label="PAN" placeholder="ABCDE1234F" />
      <Area form={form} name="address" label="Address" required className="sm:col-span-2" />
    </div>
  );
}

function OwnerFields({ form, applicantName }: { form: Form; applicantName?: string }) {
  const same = form.watch('ownerSameAsApplicant') as boolean;

  return (
    <div className="space-y-4">
      <CheckboxField
        id="ownerSameAsApplicant"
        label="The applicant is the owner of the land"
        description={
          applicantName
            ? `${applicantName} owns the property being developed.`
            : 'Tick this if the applicant owns the property being developed.'
        }
        {...form.register('ownerSameAsApplicant')}
      />

      {!same && (
        <div className={grid}>
          <SectionNote>
            The permission is granted over the owner&rsquo;s land, so these particulars form part of
            the record.
          </SectionNote>
          <Text form={form} name="ownerName" label="Owner's full name" required autoFocus />
          <Text form={form} name="ownerPhone" label="Owner's mobile number" type="tel" inputMode="numeric" required />
          <Area form={form} name="ownerAddress" label="Owner's address" required className="sm:col-span-2" />
        </div>
      )}
    </div>
  );
}

function PropertyFields({ form }: { form: Form }) {
  return (
    <div className="space-y-5">
      <div className={grid}>
        <Text form={form} name="district" label="District" required autoFocus />
        <Text form={form} name="mandal" label="Mandal" />
        <Text form={form} name="village" label="Village" />
        <Text form={form} name="localityName" label="Locality" />
        <Text form={form} name="wardNo" label="Ward number" />
      </div>

      <fieldset className="space-y-3 rounded border border-border bg-surface-sunk/50 p-4">
        <legend className="px-1 text-small font-medium text-text">Plot details</legend>
        <p className="text-caption text-text-muted">
          Select the land-pooling status and the planning zone recorded for this plot.
        </p>
        <div className={grid}>
          <Choice form={form} name="lpsStatus" label="LPS status" options={LPS_OPTIONS} />
          <Choice form={form} name="planningZone" label="Planning zone" options={PLANNING_ZONE_OPTIONS} />
        </div>
      </fieldset>
    </div>
  );
}

function LocationFields({ form, meta }: { form: Form; meta: ApplicationMeta }) {
  const zoneError = errorOf(form, 'zoneId');

  return (
    <div className="space-y-5">
      <div className={grid}>
        <Field
          label="Zone"
          htmlFor="zoneId"
          error={zoneError}
          required
          hint="Decides which office will handle the file."
        >
          <Controller
            control={form.control}
            name="zoneId"
            render={({ field }) => (
              <Select value={(field.value as string) || undefined} onValueChange={field.onChange}>
                <SelectTrigger id="zoneId" invalid={Boolean(zoneError)}>
                  <SelectValue placeholder="Choose a zone" />
                </SelectTrigger>
                <SelectContent>
                  {meta.zones.map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Text form={form} name="doorNo" label="Door number" />
        <Text form={form} name="streetName" label="Street name" required />
        <Text form={form} name="pincode" label="PIN code" inputMode="numeric" placeholder="500034" />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-small font-medium text-text">Site boundaries</legend>
        <p className="text-caption text-text-muted">
          What adjoins the plot on each side — a road, a plot number, or a neighbour&rsquo;s name.
        </p>
        <div className={grid}>
          <Text form={form} name="boundaryNorth" label="North" />
          <Text form={form} name="boundarySouth" label="South" />
          <Text form={form} name="boundaryEast" label="East" />
          <Text form={form} name="boundaryWest" label="West" />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-small font-medium text-text">Coordinates</legend>
        <p className="text-caption text-text-muted">
          Optional. Leave blank if the site has not been surveyed to a coordinate.
        </p>
        <div className={grid}>
          <Num form={form} name="latitude" label="Latitude" step="0.000001" min={-90} />
          <Num form={form} name="longitude" label="Longitude" step="0.000001" min={-180} />
        </div>
      </fieldset>
    </div>
  );
}

function SurveyFields({ form, meta }: { form: Form; meta: ApplicationMeta }) {
  return (
    <div className={grid}>
      <Text
        form={form}
        name="surveyNumbers"
        label="Survey number(s)"
        required
        autoFocus
        hint="Separate several with commas, for example 123/A, 123/B."
      />
      <Text form={form} name="plotNo" label="Plot number" />
      <Text form={form} name="layoutName" label="Layout name" />
      <Text form={form} name="lpNumber" label="LP number" hint="If the layout is already approved." />
      <Num form={form} name="plotAreaSqm" label="Plot area" suffix="sq m" step="0.01" required />
      <Num form={form} name="roadWidthM" label="Abutting road width" suffix="m" step="0.01" />
      <Choice form={form} name="landUseZone" label="Land use" options={meta.master.LAND_USE ?? []} />
      <Choice form={form} name="tenureType" label="Tenure" options={meta.master.TENURE ?? []} />
    </div>
  );
}

function DevelopmentFields({ form, meta }: { form: Form; meta: ApplicationMeta }) {
  return (
    <div className={grid}>
      <Choice
        form={form}
        name="buildingUse"
        label="Building use"
        options={meta.master.BUILDING_USE ?? []}
        required
      />
      <Text form={form} name="buildingSubUse" label="Sub-use" hint="Optional refinement of the use." />
      <Choice
        form={form}
        name="occupancyType"
        label="Occupancy type"
        options={meta.master.OCCUPANCY ?? []}
        required
      />
      <Choice
        form={form}
        name="structureType"
        label="Structure type"
        options={meta.master.STRUCTURE_TYPE ?? []}
      />
      <Num form={form} name="numFloors" label="Floors above ground" step="1" />
      <Num form={form} name="numBasements" label="Basements" step="1" />
      <Num form={form} name="numDwellingUnits" label="Dwelling units" step="1" />
      <Num form={form} name="buildingHeightM" label="Building height" suffix="m" step="0.01" />
    </div>
  );
}

function BuildingFields({ form }: { form: Form }) {
  const plotArea = Number(form.watch('plotAreaSqm')) || 0;
  const floorArea = Number(form.watch('floorAreaSqm')) || 0;
  const coverageArea = Number(form.watch('coverageAreaSqm')) || 0;

  const far = plotArea > 0 ? floorArea / plotArea : 0;
  const coverage = plotArea > 0 ? (coverageArea / plotArea) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className={grid}>
        <Num
          form={form}
          name="plotAreaSqm"
          label="Plot area"
          suffix="sq m"
          readOnly
          hint="Taken from the survey step."
        />
        <Num form={form} name="builtUpAreaSqm" label="Built-up area" suffix="sq m" step="0.01" required />
        <Num form={form} name="floorAreaSqm" label="Total floor area" suffix="sq m" step="0.01" />
        <Num form={form} name="coverageAreaSqm" label="Ground coverage" suffix="sq m" step="0.01" />
        <Num form={form} name="parkingAreaSqm" label="Parking area" suffix="sq m" step="0.01" />
      </div>

      {/*
        Derived, shown live, and never typed. The server recomputes both from
        the same inputs on save, so what is displayed here cannot become the
        value of record.
      */}
      <div className="grid gap-3 rounded border border-border bg-surface-sunk p-3 sm:grid-cols-2">
        <Derived label="Achieved FAR" value={plotArea > 0 ? far.toFixed(2) : '—'} />
        <Derived label="Achieved coverage" value={plotArea > 0 ? `${coverage.toFixed(1)}%` : '—'} />
        <p className="text-caption text-text-subtle sm:col-span-2">
          Calculated from the areas above. Whether these are permissible is decided by scrutiny
          against the byelaws, not here.
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-small font-medium text-text">Setbacks</legend>
        <p className="text-caption text-text-muted">Open space to be left on each side, in metres.</p>
        <div className={grid}>
          <Num form={form} name="setbackFrontM" label="Front" suffix="m" step="0.01" />
          <Num form={form} name="setbackRearM" label="Rear" suffix="m" step="0.01" />
          <Num form={form} name="setbackLeftM" label="Left" suffix="m" step="0.01" />
          <Num form={form} name="setbackRightM" label="Right" suffix="m" step="0.01" />
        </div>
      </fieldset>
    </div>
  );
}

function Derived({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-caption uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-h2 tabular-nums text-text">{value}</p>
    </div>
  );
}

type RegisteredProfessional = {
  registrationId: string;
  registrationNumber: string;
  typeLabel: string;
  name: string;
  licenceNo: string;
  organization: string;
  validTo: string | null;
};

/** Approved, in-force entries of the professional register, for the LTP step's two choices. */
function useRegistered(purpose: 'FILE_HOLDER' | 'STRUCTURAL', mine: boolean) {
  const [rows, setRows] = React.useState<RegisteredProfessional[] | null>(null);
  React.useEffect(() => {
    let live = true;
    api
      .get<RegisteredProfessional[]>(`/api/professionals/available?purpose=${purpose}${mine ? '&mine=true' : ''}`)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [purpose, mine]);
  return rows;
}

const validLabel = (d: string | null) => (d ? ` · valid to ${new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : '');

function RegisterSelect({
  form,
  name,
  label,
  hint,
  rows,
  none,
}: {
  form: Form;
  name: string;
  label: string;
  hint: string;
  rows: RegisteredProfessional[] | null;
  none: string;
}) {
  const error = errorOf(form, name);
  return (
    <Field label={label} htmlFor={name} error={error} hint={rows && !rows.length ? `${hint} None is approved and in force at present.` : hint}>
      <select
        id={name}
        disabled={!rows}
        className="h-9 w-full rounded border border-border-strong bg-surface px-2 text-small text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        {...form.register(name)}
      >
        <option value="">{rows ? none : 'Loading the professional register…'}</option>
        {rows?.map((r) => (
          <option key={r.registrationId} value={r.registrationId}>
            {r.registrationNumber} — {r.name} ({r.typeLabel}
            {r.organization ? `, ${r.organization}` : ''}){validLabel(r.validTo)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function LtpFields({ form }: { form: Form }) {
  const own = useRegistered('FILE_HOLDER', true);
  const structural = useRegistered('STRUCTURAL', false);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <RegisterSelect
          form={form}
          name="professionalRegistrationId"
          label="Filing under registration"
          hint="Your approved entry in the authority’s professional register."
          rows={own}
          none="— Not named —"
        />
        <RegisterSelect
          form={form}
          name="structuralEngineerRegistrationId"
          label="Structural engineer"
          hint="From the professional register — approved and in force. Leave blank where no structural certificate is called for."
          rows={structural}
          none="— None on this file —"
        />
      </div>
      <Area
        form={form}
        name="remarks"
        label="Remarks"
        rows={3}
        hint="Anything the reviewing officer should know. Optional."
      />

      <CheckboxField
        id="declarationAccepted"
        label="I make this declaration"
        description={
          'I certify that the particulars given above are true to the best of my knowledge, ' +
          'that the drawings to be submitted conform to the applicable building rules, and that ' +
          'I hold a valid licence to prepare and submit them.'
        }
        error={errorOf(form, 'declarationAccepted')}
        {...form.register('declarationAccepted')}
      />
    </div>
  );
}
