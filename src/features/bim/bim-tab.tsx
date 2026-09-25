'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Boxes,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardCheck,
  Compass,
  Download,
  FilePlus2,
  Gavel,
  Layers,
  Lock,
  Plus,
  Ruler,
  Save,
  ShieldCheck,
  Trash2,
  UserCog,
  Waypoints,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/common/status-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/drawings';
import {
  AUTHORING_TOOLS,
  BIM_CONTENT_ITEMS,
  BIM_DECLARATION_TEXT,
  BIM_DISCIPLINES,
  CLASSIFICATION_SYSTEMS,
  CRS_OPTIONS,
  IFC_COUNTED,
  IFC_SCHEMAS,
  INFORMATION_STANDARDS,
  LENGTH_UNITS,
  LOD_LEVELS,
  MODEL_VIEW_DEFINITIONS,
  REVIEW_STATUSES,
  VERTICAL_DATUMS,
  bimLabel,
  type CheckStatus,
  type IfcFacts,
} from '@/lib/bim';
import { api, ApiCallError } from '@/features/applications/api';
import { BimUploadPanel } from './upload-panel';
import { BimViewer } from './bim-viewer';
import { NativeSelect } from './native-select';
import type { BimModelRow, BimPayload, BimRecord, BimStorey, BimVersionRow } from './types';

/**
 * THE BIM TAB — the building information model that travels with the
 * drawings.
 *
 * Read top to bottom it answers, in order, the questions an officer brings to
 * a BIM-based file: is it ready (readiness), what was submitted (files), what
 * does the model itself say (facts read from the IFC), does that agree with
 * the application (reconciliation), and then the particulars the LTP states,
 * the LTP's declaration and the department's review.
 *
 * Saving is one card at a time, as on the Others tab: the PATCH is partial.
 */
export function BimTab({
  initial,
  canUpload,
  canReview,
  maxUploadBytes,
}: {
  initial: BimPayload;
  /** DRAWING_UPLOAD, from the server. The status gate is inside `initial`. */
  canUpload: boolean;
  /** CHECKLIST_REVIEW, from the server. */
  canReview: boolean;
  maxUploadBytes: number;
}) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [draft, setDraft] = React.useState<Partial<BimRecord>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [versioning, setVersioning] = React.useState<BimModelRow | null>(null);

  React.useEffect(() => {
    setData(initial);
    setDraft({});
  }, [initial]);

  const applicationId = data.application.id;
  const value = { ...data.bim, ...draft };
  const canEdit = canUpload && data.canEdit;

  const set = <K extends keyof BimRecord>(key: K, next: BimRecord[K]) =>
    setDraft((prev) => ({ ...prev, [key]: next }));

  const dirtyIn = (keys: Array<keyof BimRecord>) =>
    keys.filter((k) => k in draft && JSON.stringify(draft[k]) !== JSON.stringify(data.bim[k]));

  const refresh = React.useCallback(async () => {
    try {
      setData(await api.get<BimPayload>(`/api/applications/${applicationId}/bim`));
    } catch {
      /* keep the last good data */
    }
    router.refresh();
  }, [applicationId, router]);

  async function send(card: string, payload: Record<string, unknown>, clear: Array<keyof BimRecord> = []) {
    setBusy(card);
    try {
      const next = await api.patch<BimPayload>(`/api/applications/${applicationId}/bim`, payload);
      setData(next);
      setDraft((prev) => {
        const rest = { ...prev };
        for (const key of clear) delete rest[key];
        return rest;
      });
      toast.success(`${card} saved`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'That did not work. Try again shortly.');
    } finally {
      setBusy(null);
    }
  }

  function save(card: string, keys: Array<keyof BimRecord>) {
    const dirty = dirtyIn(keys);
    if (!dirty.length) return;
    const payload: Record<string, unknown> = {};
    for (const key of dirty) payload[key] = value[key];
    void send(card, payload, dirty);
  }

  const block = (card: string, keys: Array<keyof BimRecord>) => ({
    busy: busy === card,
    dirty: dirtyIn(keys).length > 0,
    canEdit,
    onSave: () => save(card, keys),
  });

  const ifcModels = data.models.filter((m) => m.kind === 'IFC_MODEL');
  const facts = data.primaryFacts;
  const activeIfc = ifcModels[0]?.versions.find((version) => version.isActive) ?? null;

  return (
    <div className="space-y-4">
      {!canEdit && data.editBlockedReason && (
        <div className="flex items-start gap-2 rounded border border-border bg-surface-sunk px-3 py-2.5">
          <Lock className="mt-0.5 size-4 shrink-0 text-text-subtle" />
          <p className="text-small text-text-muted">{data.editBlockedReason}</p>
        </div>
      )}

      {data.bim.reviewStatus === 'CORRECTIONS_REQUIRED' && (
        <p className="flex items-start gap-2 rounded border border-warning/25 bg-warning-bg px-3 py-2 text-small text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">The department returned the model for correction.</span>{' '}
            {data.bim.reviewRemarks}
          </span>
        </p>
      )}

      <BimViewer
        applicationNumber={data.application.applicationNumber}
        model={ifcModels[0] ?? null}
        activeVersion={activeIfc}
        facts={facts}
        readiness={data.readiness}
      />

      {/* ══ Readiness ═══════════════════════════════════════════════════ */}
      <ReadinessCard readiness={data.readiness} reviewStatus={data.bim.reviewStatus} />

      {/* ══ Files ═══════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="size-4 text-text-muted" />
              Model files
            </CardTitle>
            <CardDescription>
              The IFC model (ISO 16739) and its supporting deliverables. Every file is versioned — a
              correction never replaces what came before.
            </CardDescription>
          </div>
          {canEdit && !adding && data.models.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Add a file
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit && (adding || data.models.length === 0) && (
            <BimUploadPanel
              applicationId={applicationId}
              maxUploadBytes={maxUploadBytes}
              onUploaded={() => {
                setAdding(false);
                void refresh();
              }}
              onCancel={data.models.length ? () => setAdding(false) : undefined}
            />
          )}

          {versioning && (
            <div className="rounded border border-primary/30 p-4">
              <p className="mb-3 text-small font-medium text-text">
                New version of {versioning.title} — becomes V{versioning.currentVersionNo + 1}
              </p>
              <BimUploadPanel
                applicationId={applicationId}
                maxUploadBytes={maxUploadBytes}
                bimModelId={versioning.id}
                fixedKind={versioning.kind}
                onUploaded={() => {
                  setVersioning(null);
                  void refresh();
                }}
                onCancel={() => setVersioning(null)}
              />
            </div>
          )}

          {data.models.length === 0 && !canEdit && (
            <p className="text-small text-text-muted">No BIM files have been submitted on this application.</p>
          )}

          {data.models.map((model) => (
            <ModelFiles
              key={model.id}
              model={model}
              canUpload={canEdit}
              onNewVersion={() => setVersioning(model)}
            />
          ))}
        </CardContent>
      </Card>

      {/* ══ What the model says ═════════════════════════════════════════ */}
      {ifcModels.length > 0 && <FactsCard facts={facts} />}

      {/* ══ Reconciliation ══════════════════════════════════════════════ */}
      <ReconciliationCard rows={data.readiness.reconciliation} />

      {/* ══ Model particulars ═══════════════════════════════════════════ */}
      <Block
        icon={Layers}
        title="Model particulars"
        description="How the model was authored and exported. Blank fields are filled from the IFC header when a model is uploaded."
        {...block('Model particulars', [
          'modelReference',
          'authoringSoftware',
          'authoringVersion',
          'ifcSchema',
          'modelViewDefinition',
          'levelOfDevelopment',
          'classificationSystem',
          'lengthUnit',
          'disciplines',
        ])}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField id="modelReference" label="Model reference" hint="Your file or container name." value={value.modelReference} disabled={!canEdit} onChange={(v) => set('modelReference', v)} />
          <SelectField id="authoringSoftware" label="Authoring software" options={AUTHORING_TOOLS} value={value.authoringSoftware} disabled={!canEdit} onChange={(v) => set('authoringSoftware', v)} />
          <TextField id="authoringVersion" label="Software version" value={value.authoringVersion} disabled={!canEdit} onChange={(v) => set('authoringVersion', v)} />
          <SelectField id="ifcSchema" label="IFC schema" options={IFC_SCHEMAS} value={value.ifcSchema} disabled={!canEdit} onChange={(v) => set('ifcSchema', v)} />
          <SelectField id="modelViewDefinition" label="Model view definition" options={MODEL_VIEW_DEFINITIONS} value={value.modelViewDefinition} disabled={!canEdit} onChange={(v) => set('modelViewDefinition', v)} />
          <SelectField id="levelOfDevelopment" label="Level of development" options={LOD_LEVELS} value={value.levelOfDevelopment} disabled={!canEdit} onChange={(v) => set('levelOfDevelopment', v)} />
          <SelectField id="classificationSystem" label="Classification system" options={CLASSIFICATION_SYSTEMS} value={value.classificationSystem} disabled={!canEdit} onChange={(v) => set('classificationSystem', v)} />
          <SelectField id="lengthUnit" label="Length unit" options={LENGTH_UNITS} value={value.lengthUnit} disabled={!canEdit} onChange={(v) => set('lengthUnit', v)} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-small font-medium text-text">Disciplines in the model</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {BIM_DISCIPLINES.map((d) => (
              <CheckRow
                key={d.code}
                id={`discipline-${d.code}`}
                label={d.label}
                checked={value.disciplines.includes(d.code)}
                disabled={!canEdit}
                onChange={(on) =>
                  set('disciplines', on ? [...value.disciplines, d.code] : value.disciplines.filter((c) => c !== d.code))
                }
              />
            ))}
          </div>
        </fieldset>
      </Block>

      {/* ══ Georeferencing ══════════════════════════════════════════════ */}
      <Block
        icon={Compass}
        title="Georeferencing"
        description="Where the model sits on the earth — the coordinate reference system, the site position and the model origin (IfcMapConversion)."
        {...block('Georeferencing', [
          'crsCode',
          'verticalDatum',
          'siteLatitude',
          'siteLongitude',
          'originEasting',
          'originNorthing',
          'originHeightM',
          'trueNorthDeg',
        ])}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField id="crsCode" label="Coordinate reference system" options={CRS_OPTIONS} value={value.crsCode} disabled={!canEdit} onChange={(v) => set('crsCode', v)} className="lg:col-span-2" />
          <SelectField id="verticalDatum" label="Vertical datum" options={VERTICAL_DATUMS} value={value.verticalDatum} disabled={!canEdit} onChange={(v) => set('verticalDatum', v)} className="lg:col-span-2" />
          <NumberField id="siteLatitude" label="Site latitude (°)" step="0.000001" value={value.siteLatitude} disabled={!canEdit} onChange={(v) => set('siteLatitude', v)} />
          <NumberField id="siteLongitude" label="Site longitude (°)" step="0.000001" value={value.siteLongitude} disabled={!canEdit} onChange={(v) => set('siteLongitude', v)} />
          <NumberField id="originEasting" label="Origin easting (m)" step="0.001" value={value.originEasting} disabled={!canEdit} onChange={(v) => set('originEasting', v)} />
          <NumberField id="originNorthing" label="Origin northing (m)" step="0.001" value={value.originNorthing} disabled={!canEdit} onChange={(v) => set('originNorthing', v)} />
          <NumberField id="originHeightM" label="Origin height (m)" hint="Above the vertical datum." step="0.001" value={value.originHeightM} disabled={!canEdit} onChange={(v) => set('originHeightM', v)} />
          <NumberField id="trueNorthDeg" label="True north (°)" hint="Clockwise from grid north." step="0.01" value={value.trueNorthDeg} disabled={!canEdit} onChange={(v) => set('trueNorthDeg', v)} />
        </div>
      </Block>

      {/* ══ Model quantities ════════════════════════════════════════════ */}
      <Block
        icon={Ruler}
        title="Model quantities"
        description="The figures as the model reports them, from the authoring tool's schedules. They are compared with the application above."
        {...block('Model quantities', [
          'modelPlotAreaSqm',
          'modelBuiltUpAreaSqm',
          'modelCoverageAreaSqm',
          'modelFarAreaSqm',
          'modelBuildingHeightM',
          'modelNumFloors',
          'modelNumBasements',
          'modelDwellingUnits',
          'modelParkingSpaces',
          'modelSetbackFrontM',
          'modelSetbackRearM',
          'modelSetbackLeftM',
          'modelSetbackRightM',
          'storeys',
        ])}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField id="modelPlotAreaSqm" label="Plot area (sq m)" value={value.modelPlotAreaSqm} disabled={!canEdit} onChange={(v) => set('modelPlotAreaSqm', v)} />
          <NumberField id="modelBuiltUpAreaSqm" label="Built-up area (sq m)" value={value.modelBuiltUpAreaSqm} disabled={!canEdit} onChange={(v) => set('modelBuiltUpAreaSqm', v)} />
          <NumberField id="modelCoverageAreaSqm" label="Ground coverage (sq m)" value={value.modelCoverageAreaSqm} disabled={!canEdit} onChange={(v) => set('modelCoverageAreaSqm', v)} />
          <NumberField id="modelFarAreaSqm" label="FAR floor area (sq m)" hint="Built-up area less exempt parts." value={value.modelFarAreaSqm} disabled={!canEdit} onChange={(v) => set('modelFarAreaSqm', v)} />
          <NumberField id="modelBuildingHeightM" label="Building height (m)" value={value.modelBuildingHeightM} disabled={!canEdit} onChange={(v) => set('modelBuildingHeightM', v)} />
          <NumberField id="modelNumFloors" label="Floors" integer value={value.modelNumFloors} disabled={!canEdit} onChange={(v) => set('modelNumFloors', v)} />
          <NumberField id="modelNumBasements" label="Basements" integer value={value.modelNumBasements} disabled={!canEdit} onChange={(v) => set('modelNumBasements', v)} />
          <NumberField id="modelDwellingUnits" label="Dwelling units" integer value={value.modelDwellingUnits} disabled={!canEdit} onChange={(v) => set('modelDwellingUnits', v)} />
          <NumberField id="modelParkingSpaces" label="Parking spaces" integer value={value.modelParkingSpaces} disabled={!canEdit} onChange={(v) => set('modelParkingSpaces', v)} />
          <NumberField id="modelSetbackFrontM" label="Front setback (m)" value={value.modelSetbackFrontM} disabled={!canEdit} onChange={(v) => set('modelSetbackFrontM', v)} />
          <NumberField id="modelSetbackRearM" label="Rear setback (m)" value={value.modelSetbackRearM} disabled={!canEdit} onChange={(v) => set('modelSetbackRearM', v)} />
          <NumberField id="modelSetbackLeftM" label="Left setback (m)" value={value.modelSetbackLeftM} disabled={!canEdit} onChange={(v) => set('modelSetbackLeftM', v)} />
          <NumberField id="modelSetbackRightM" label="Right setback (m)" value={value.modelSetbackRightM} disabled={!canEdit} onChange={(v) => set('modelSetbackRightM', v)} />
        </div>

        <StoreyEditor storeys={value.storeys} disabled={!canEdit} onChange={(next) => set('storeys', next)} />
      </Block>

      {/* ══ Model content ═══════════════════════════════════════════════ */}
      <Block
        icon={ClipboardCheck}
        title="Model content"
        description="What the model contains. Items marked required are the ones the building rules are checked against."
        {...block('Model content', ['contentChecklist'])}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {BIM_CONTENT_ITEMS.map((item) => (
            <CheckRow
              key={item.code}
              id={`content-${item.code}`}
              label={item.label}
              badge={item.required ? 'Required' : undefined}
              checked={Boolean(value.contentChecklist[item.code])}
              disabled={!canEdit}
              onChange={(on) => set('contentChecklist', { ...value.contentChecklist, [item.code]: on })}
            />
          ))}
        </div>
      </Block>

      {/* ══ Coordination ════════════════════════════════════════════════ */}
      <Block
        icon={Waypoints}
        title="Coordination and model quality"
        description="Clash detection across the federated disciplines, IFC validation, and whether the drawings were produced from this model."
        {...block('Coordination', [
          'clashDetectionDone',
          'clashTool',
          'clashDetectionDate',
          'unresolvedHardClashes',
          'unresolvedSoftClashes',
          'ifcValidationDone',
          'ifcValidationTool',
          'drawingsFromModel',
        ])}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle id="clashDetectionDone" label="Clash detection carried out" checked={value.clashDetectionDone} disabled={!canEdit} onChange={(v) => set('clashDetectionDone', v)} />
          <Toggle id="ifcValidationDone" label="IFC file validated" checked={value.ifcValidationDone} disabled={!canEdit} onChange={(v) => set('ifcValidationDone', v)} />
          <Toggle id="drawingsFromModel" label="Drawings generated from this model" checked={value.drawingsFromModel} disabled={!canEdit} onChange={(v) => set('drawingsFromModel', v)} />
        </div>
        {value.clashDetectionDone && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TextField id="clashTool" label="Clash tool" hint="e.g. Navisworks, Solibri." value={value.clashTool} disabled={!canEdit} onChange={(v) => set('clashTool', v)} />
            <Field label="Run on" htmlFor="clashDetectionDate">
              <Input id="clashDetectionDate" type="date" value={value.clashDetectionDate?.slice(0, 10) ?? ''} disabled={!canEdit} onChange={(e) => set('clashDetectionDate', e.target.value || null)} />
            </Field>
            <NumberField id="unresolvedHardClashes" label="Unresolved hard clashes" integer value={value.unresolvedHardClashes} disabled={!canEdit} onChange={(v) => set('unresolvedHardClashes', v)} />
            <NumberField id="unresolvedSoftClashes" label="Unresolved soft clashes" integer value={value.unresolvedSoftClashes} disabled={!canEdit} onChange={(v) => set('unresolvedSoftClashes', v)} />
          </div>
        )}
        {value.ifcValidationDone && (
          <TextField id="ifcValidationTool" label="Validation tool" hint="e.g. buildingSMART Validation Service." value={value.ifcValidationTool} disabled={!canEdit} onChange={(v) => set('ifcValidationTool', v)} />
        )}
      </Block>

      {/* ══ Information management ══════════════════════════════════════ */}
      <Block
        icon={UserCog}
        title="Information management"
        description="The standard the model was produced under, where it is held, and the person who answers for it."
        {...block('Information management', [
          'informationStandard',
          'bepReference',
          'cdePlatform',
          'bimManagerName',
          'bimManagerOrganisation',
          'bimManagerEmail',
          'bimManagerPhone',
          'bimManagerCredential',
          'remarks',
        ])}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField id="informationStandard" label="Information standard" options={INFORMATION_STANDARDS} value={value.informationStandard} disabled={!canEdit} onChange={(v) => set('informationStandard', v)} />
          <TextField id="bepReference" label="BIM Execution Plan reference" value={value.bepReference} disabled={!canEdit} onChange={(v) => set('bepReference', v)} />
          <TextField id="cdePlatform" label="Common data environment" hint="Where the live model is held." value={value.cdePlatform} disabled={!canEdit} onChange={(v) => set('cdePlatform', v)} />
          <TextField id="bimManagerName" label="BIM manager" value={value.bimManagerName} disabled={!canEdit} onChange={(v) => set('bimManagerName', v)} />
          <TextField id="bimManagerOrganisation" label="Organisation" value={value.bimManagerOrganisation} disabled={!canEdit} onChange={(v) => set('bimManagerOrganisation', v)} />
          <TextField id="bimManagerCredential" label="Credential / licence" value={value.bimManagerCredential} disabled={!canEdit} onChange={(v) => set('bimManagerCredential', v)} />
          <TextField id="bimManagerEmail" label="Email" type="email" value={value.bimManagerEmail} disabled={!canEdit} onChange={(v) => set('bimManagerEmail', v)} />
          <TextField id="bimManagerPhone" label="Phone" type="tel" value={value.bimManagerPhone} disabled={!canEdit} onChange={(v) => set('bimManagerPhone', v)} />
        </div>
        <Field label="Remarks" htmlFor="bim-remarks-field">
          <Textarea id="bim-remarks-field" rows={2} value={value.remarks} disabled={!canEdit} onChange={(e) => set('remarks', e.target.value)} />
        </Field>
      </Block>

      {/* ══ Declaration ═════════════════════════════════════════════════ */}
      <DeclarationCard
        bim={data.bim}
        canDeclare={canEdit && data.isApplicant}
        hasModel={ifcModels.length > 0}
        unsaved={Object.keys(draft).length > 0}
        busy={busy === 'Declaration'}
        onDeclare={(on) => void send('Declaration', { declare: on })}
      />

      {/* ══ Review ══════════════════════════════════════════════════════ */}
      {(canReview || data.bim.reviewedAt) && (
        <ReviewCard
          bim={data.bim}
          canReview={canReview && data.reviewOpen && !data.isApplicant}
          applicationId={applicationId}
          onReviewed={(next) => {
            setData(next);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Readiness
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_ICON: Record<CheckStatus, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  PASS: { icon: CircleCheck, tone: 'text-success' },
  WARN: { icon: AlertTriangle, tone: 'text-warning' },
  FAIL: { icon: CircleX, tone: 'text-danger' },
  PENDING: { icon: CircleDashed, tone: 'text-text-subtle' },
};

function ReadinessCard({
  readiness,
  reviewStatus,
}: {
  readiness: BimPayload['readiness'];
  reviewStatus: string;
}) {
  const failing = readiness.checks.filter((c) => c.status === 'FAIL').length;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-text-muted" />
            BIM readiness
          </CardTitle>
          <CardDescription>
            Whether the model can support this permission: readable, georeferenced, complete, and in
            agreement with what the application declares.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={reviewStatus === 'ACCEPTED' ? 'success' : reviewStatus === 'CORRECTIONS_REQUIRED' ? 'warning' : 'outline'}>
            Review: {bimLabel(reviewStatus, REVIEW_STATUSES)}
          </Badge>
          <Badge tone={readiness.ready ? 'success' : failing ? 'danger' : 'warning'}>
            {readiness.ready ? 'Ready for review' : failing ? `${failing} to fix` : 'Incomplete'} · {readiness.score}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-sunk" role="progressbar" aria-valuenow={readiness.score} aria-valuemin={0} aria-valuemax={100} aria-label="BIM readiness">
          <div
            className={cn('h-full rounded-full', readiness.ready ? 'bg-success' : failing ? 'bg-danger' : 'bg-warning')}
            style={{ width: `${readiness.score}%` }}
          />
        </div>
        <ul className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
          {readiness.checks.map((check) => {
            const { icon: Icon, tone } = STATUS_ICON[check.status];
            return (
              <li key={check.code} className="flex items-start gap-2">
                <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} aria-hidden />
                <div className="min-w-0">
                  <p className="text-small font-medium text-text">
                    {check.label}
                    <span className="sr-only"> — {check.status.toLowerCase()}</span>
                  </p>
                  <p className="text-caption text-text-muted">{check.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Files
// ═══════════════════════════════════════════════════════════════════════════

function ModelFiles({
  model,
  canUpload,
  onNewVersion,
}: {
  model: BimModelRow;
  canUpload: boolean;
  onNewVersion: () => void;
}) {
  return (
    <div className="overflow-hidden rounded border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-sunk/60 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-small font-medium text-text">{model.title}</span>
          <Badge tone="outline">{bimLabel(model.kind)}</Badge>
          {model.kind === 'IFC_MODEL' && (
            <Badge tone="info">{model.discipline === 'FEDERATED' ? 'Federated' : bimLabel(model.discipline, BIM_DISCIPLINES)}</Badge>
          )}
        </div>
        {canUpload && (
          <Button size="sm" variant="ghost" onClick={onNewVersion}>
            <FilePlus2 className="size-4" />
            New version
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Version</TableHead>
            <TableHead>Uploaded by</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead>Status</TableHead>
            {model.kind === 'IFC_MODEL' && <TableHead>Read from the file</TableHead>}
            <TableHead className="text-right">File</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.versions.map((v) => (
            <VersionRow key={v.id} version={v} showFacts={model.kind === 'IFC_MODEL'} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function VersionRow({ version, showFacts }: { version: BimVersionRow; showFacts: boolean }) {
  const facts = version.ifcFacts as Partial<IfcFacts>;
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium tabular-nums text-text">V{version.versionNo}</span>
        {version.remarks && (
          <p className="mt-0.5 max-w-[28ch] truncate text-caption text-text-muted" title={version.remarks}>
            {version.remarks}
          </p>
        )}
      </TableCell>
      <TableCell className="text-small text-text-muted">{version.uploadedByName}</TableCell>
      <TableCell className="whitespace-nowrap text-small text-text-muted">{formatDate(version.uploadedAt)}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          {version.isActive ? <Badge tone="success">Current</Badge> : <Badge tone="neutral">Superseded</Badge>}
          <StatusBadge kind="scan" status={version.file.scanStatus} />
        </div>
      </TableCell>
      {showFacts && (
        <TableCell className="text-caption text-text-muted">
          {facts.parsed ? (
            <span className="whitespace-nowrap">
              {facts.schema} · {facts.storeys?.length ?? 0} storeys · {facts.counts?.IFCSPACE ?? 0} spaces
            </span>
          ) : (
            <span className="text-danger">{facts.error ?? 'Not read'}</span>
          )}
        </TableCell>
      )}
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <span className="whitespace-nowrap text-caption text-text-subtle">{formatBytes(version.file.sizeBytes)}</span>
          {version.downloadable ? (
            <Button asChild size="sm" variant="ghost">
              <a href={`/api/bim/versions/${version.id}/download`}>
                <Download className="size-4" />
                <span className="sr-only">Download V{version.versionNo}</span>
              </a>
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button size="sm" variant="ghost" disabled>
                    <ShieldCheck className="size-4" />
                    <span className="sr-only">Download unavailable</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>This file has not cleared the virus check yet, so it cannot be downloaded.</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// What the model says
// ═══════════════════════════════════════════════════════════════════════════

function FactsCard({ facts }: { facts: IfcFacts | null }) {
  if (!facts) return null;
  if (!facts.parsed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What the model says</CardTitle>
          <CardDescription className="text-danger">{facts.error ?? 'The current model could not be read.'}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const geo = facts.georef;
  const rows: Array<[string, string]> = [
    ['Schema', facts.schema || '—'],
    ['View definition', facts.viewDefinition || '—'],
    ['Exported from', facts.originatingSystem || '—'],
    ['Author', [facts.author, facts.organization].filter(Boolean).join(' · ') || '—'],
    ['Exported on', facts.timeStamp || '—'],
    ['Length unit', facts.lengthUnit || '—'],
    ['Project / site / building', [facts.projectName, facts.siteName, facts.buildingName].filter(Boolean).join(' / ') || '—'],
    [
      'Georeferencing',
      geo.hasMapConversion
        ? `IfcMapConversion${geo.crsName ? ` · ${geo.crsName}` : ''} · E ${fmt(geo.eastings)} N ${fmt(geo.northings)}`
        : 'No IfcMapConversion',
    ],
    [
      'Site position',
      geo.refLatitude !== null && geo.refLongitude !== null
        ? `${geo.refLatitude.toFixed(6)}°, ${geo.refLongitude.toFixed(6)}°${geo.refElevation !== null ? ` · ${geo.refElevation} m` : ''}`
        : 'Not set on IfcSite',
    ],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>What the model says</CardTitle>
        <CardDescription>
          Read by the system from the current IFC model — not typed by anybody. {facts.entityCount.toLocaleString('en-IN')} entities.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5 text-small">
          {rows.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-text-muted">{k}</dt>
              <dd className="min-w-0 break-words text-text">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-small font-medium text-text">Storeys ({facts.storeys.length})</p>
            {facts.storeys.length ? (
              <ul className="divide-y divide-border rounded border border-border text-small">
                {facts.storeys.map((s, i) => (
                  <li key={`${s.name}-${i}`} className="flex justify-between gap-2 px-3 py-1.5">
                    <span className="truncate text-text">{s.name}</span>
                    <span className="tabular-nums text-text-muted">{s.elevationM === null ? '—' : `${s.elevationM.toFixed(2)} m`}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-danger">The model contains no IfcBuildingStorey.</p>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-small font-medium text-text">Elements</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {IFC_COUNTED.map(({ entity, label }) => (
                <div key={entity} className="rounded border border-border px-2 py-1.5">
                  <p className="text-caption text-text-muted">{label}</p>
                  <p className="text-small font-medium tabular-nums text-text">{(facts.counts[entity] ?? 0).toLocaleString('en-IN')}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Reconciliation
// ═══════════════════════════════════════════════════════════════════════════

function ReconciliationCard({ rows }: { rows: BimPayload['readiness']['reconciliation'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Application against model</CardTitle>
        <CardDescription>
          What the application declares beside what the model reports. A mismatch outside tolerance means one
          of them is wrong.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Parameter</TableHead>
              <TableHead className="text-right">Declared</TableHead>
              <TableHead className="text-right">Model</TableHead>
              <TableHead className="text-right">Difference</TableHead>
              <TableHead>Tolerance</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.code}>
                <TableCell className="text-small font-medium text-text">{r.label}</TableCell>
                <TableCell className="text-right text-small tabular-nums">{withUnit(r.declared, r.unit)}</TableCell>
                <TableCell className="text-right text-small tabular-nums">{withUnit(r.model, r.unit)}</TableCell>
                <TableCell className={cn('text-right text-small tabular-nums', r.status === 'MISMATCH' && 'text-danger')}>
                  {r.difference === null ? '—' : `${r.difference > 0 ? '+' : ''}${r.difference}`}
                </TableCell>
                <TableCell className="text-caption text-text-muted">{r.tolerance}</TableCell>
                <TableCell>
                  {r.status === 'MATCH' ? (
                    <Badge tone="success">Agrees</Badge>
                  ) : r.status === 'MISMATCH' ? (
                    <Badge tone="danger">Mismatch</Badge>
                  ) : (
                    <Badge tone="outline">Not stated</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Storeys
// ═══════════════════════════════════════════════════════════════════════════

function StoreyEditor({
  storeys,
  disabled,
  onChange,
}: {
  storeys: BimStorey[];
  disabled: boolean;
  onChange: (next: BimStorey[]) => void;
}) {
  const update = (i: number, patch: Partial<BimStorey>) =>
    onChange(storeys.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-small font-medium text-text">Level schedule</p>
        {!disabled && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange([...storeys, { name: `Level ${storeys.length}`, elevationM: null, heightM: null, grossAreaSqm: null, use: '' }])}
          >
            <Plus className="size-4" />
            Add level
          </Button>
        )}
      </div>
      {storeys.length === 0 ? (
        <p className="text-caption text-text-muted">No levels yet. Uploading an IFC model fills this from its storeys.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Level</TableHead>
                <TableHead>Elevation (m)</TableHead>
                <TableHead>Height (m)</TableHead>
                <TableHead>Gross area (sq m)</TableHead>
                <TableHead>Use</TableHead>
                {!disabled && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {storeys.map((s, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input aria-label="Level name" value={s.name} disabled={disabled} onChange={(e) => update(i, { name: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Input aria-label="Elevation" type="number" step="0.01" value={s.elevationM ?? ''} disabled={disabled} onChange={(e) => update(i, { elevationM: numberOrNull(e.target.value) })} />
                  </TableCell>
                  <TableCell>
                    <Input aria-label="Height" type="number" step="0.01" min={0} value={s.heightM ?? ''} disabled={disabled} onChange={(e) => update(i, { heightM: numberOrNull(e.target.value) })} />
                  </TableCell>
                  <TableCell>
                    <Input aria-label="Gross area" type="number" step="0.01" min={0} value={s.grossAreaSqm ?? ''} disabled={disabled} onChange={(e) => update(i, { grossAreaSqm: numberOrNull(e.target.value) })} />
                  </TableCell>
                  <TableCell>
                    <Input aria-label="Use" value={s.use} disabled={disabled} placeholder="Residential" onChange={(e) => update(i, { use: e.target.value })} />
                  </TableCell>
                  {!disabled && (
                    <TableCell>
                      <Button size="icon" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => onChange(storeys.filter((_, j) => j !== i))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {storeys.some((s) => s.grossAreaSqm !== null) && (
        <p className="text-caption text-text-muted">
          Sum of level areas: {storeys.reduce((n, s) => n + (s.grossAreaSqm ?? 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} sq m
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Declaration and review
// ═══════════════════════════════════════════════════════════════════════════

function DeclarationCard({
  bim,
  canDeclare,
  hasModel,
  unsaved,
  busy,
  onDeclare,
}: {
  bim: BimRecord;
  canDeclare: boolean;
  hasModel: boolean;
  unsaved: boolean;
  busy: boolean;
  onDeclare: (on: boolean) => void;
}) {
  const [accepted, setAccepted] = React.useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="size-4 text-text-muted" />
          LTP declaration
        </CardTitle>
        <CardDescription>
          Made against the current model. Uploading a new version or changing any particular withdraws it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded border border-border bg-surface-sunk/60 px-3 py-2 text-small text-text">{BIM_DECLARATION_TEXT}</p>

        {bim.declaredAt ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-small text-success">
              <CircleCheck className="size-4" aria-hidden />
              Declared by {bim.declaredByName ?? 'the LTP'} on {formatDate(bim.declaredAt)}.
            </p>
            {canDeclare && (
              <Button size="sm" variant="ghost" onClick={() => onDeclare(false)} disabled={busy}>
                Withdraw
              </Button>
            )}
          </div>
        ) : canDeclare ? (
          <>
            <div className="flex items-start gap-2.5">
              <Checkbox id="bim-declare" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <Label htmlFor="bim-declare" className="cursor-pointer text-small font-normal">
                I make this declaration.
              </Label>
            </div>
            {!hasModel && <p className="text-caption text-text-muted">Upload the IFC model first.</p>}
            {unsaved && <p className="text-caption text-warning">Save your changes above before declaring.</p>}
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => onDeclare(true)} disabled={!accepted || !hasModel || unsaved || busy} loading={busy}>
                Declare
              </Button>
            </div>
          </>
        ) : (
          <p className="text-small text-text-muted">Not yet declared.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewCard({
  bim,
  canReview,
  applicationId,
  onReviewed,
}: {
  bim: BimRecord;
  canReview: boolean;
  applicationId: string;
  onReviewed: (next: BimPayload) => void;
}) {
  const [status, setStatus] = React.useState(bim.reviewStatus === 'NOT_REVIEWED' ? '' : bim.reviewStatus);
  const [remarks, setRemarks] = React.useState(bim.reviewRemarks);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    try {
      const next = await api.post<BimPayload>(`/api/applications/${applicationId}/bim/review`, {
        reviewStatus: status,
        reviewRemarks: remarks,
      });
      toast.success('Review recorded');
      onReviewed(next);
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'That did not work. Try again shortly.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-text-muted" />
          Department review
        </CardTitle>
        <CardDescription>
          {bim.reviewedAt
            ? `Last reviewed by ${bim.reviewedByName ?? 'an officer'} on ${formatDate(bim.reviewedAt)}: ${bimLabel(bim.reviewStatus, REVIEW_STATUSES)}.`
            : 'The officer’s verdict on the model. The applicant sees it on this tab.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {canReview ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Outcome" htmlFor="bim-review-status" required>
                <NativeSelect
                  id="bim-review-status"
                  value={status}
                  placeholder="Choose"
                  options={REVIEW_STATUSES.filter((s) => s.code !== 'NOT_REVIEWED')}
                  onChange={setStatus}
                />
              </Field>
              <Field label="Remarks" htmlFor="bim-review-remarks" className="sm:col-span-2" hint={status === 'CORRECTIONS_REQUIRED' ? 'Required — say what needs correcting.' : undefined}>
                <Textarea id="bim-review-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={submit} disabled={!status || busy} loading={busy}>
                Record review
              </Button>
            </div>
          </>
        ) : (
          bim.reviewRemarks && <p className="text-small text-text">{bim.reviewRemarks}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Pieces
// ═══════════════════════════════════════════════════════════════════════════

function Block({
  icon: Icon,
  title,
  description,
  children,
  dirty,
  busy,
  canEdit,
  onSave,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
  dirty: boolean;
  busy: boolean;
  canEdit: boolean;
  onSave: () => void;
}) {
  return (
    <Card className={cn(dirty && 'border-primary/40')}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Icon className="size-4 text-text-muted" />
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {canEdit && dirty && (
            <Button variant="primary" size="sm" onClick={onSave} disabled={busy}>
              <Save className="size-4" aria-hidden />
              Save
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function TextField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
  type = 'text',
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
  integer,
  step,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number | null;
  disabled: boolean;
  onChange: (v: number | null) => void;
  integer?: boolean;
  step?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type="number"
        step={step ?? (integer ? '1' : '0.01')}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const n = numberOrNull(e.target.value);
          onChange(n === null ? null : integer ? Math.trunc(n) : n);
        }}
      />
    </Field>
  );
}

function SelectField({
  id,
  label,
  options,
  value,
  disabled,
  onChange,
  className,
}: {
  id: string;
  label: string;
  options: Array<{ code: string; label: string; hint?: string }>;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <Field label={label} htmlFor={id} className={className}>
      <NativeSelect id={id} value={value} options={options} disabled={disabled} onChange={onChange} />
    </Field>
  );
}

function Toggle({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <Label htmlFor={id} className="cursor-pointer text-small font-normal">
        {label}
      </Label>
    </div>
  );
}

function CheckRow({
  id,
  label,
  badge,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  badge?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox id={id} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <Label htmlFor={id} className="cursor-pointer text-small font-normal">
        {label}
        {badge && (
          <Badge tone="outline" className="ml-2 align-middle">
            {badge}
          </Badge>
        )}
      </Label>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

const numberOrNull = (value: string): number | null =>
  value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 }));

const withUnit = (n: number | null, unit: string) =>
  n === null ? '—' : `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;

const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
