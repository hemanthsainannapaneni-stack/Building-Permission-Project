'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Award, Building2, Check, ClipboardCheck, FileWarning, Gavel, Info, Ruler, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/features/applications/api';
import {
  AS_BUILT_PARAMETERS,
  INSPECTION_RECOMMENDATIONS,
  INSPECTION_RECOMMENDATION_LABEL,
  OCCUPANCY_DOCUMENTS,
  OCCUPANCY_DOCUMENT_LABEL,
  OCCUPANCY_PHOTO_LABEL,
  OCCUPANCY_STATE_LABEL,
  REQUIRED_OCCUPANCY_DOCUMENTS,
  REVIEW_RECOMMENDATION_LABEL,
  type AsBuiltKey,
  type ComparisonRow,
  type InspectionRecommendation,
  type OccupancyDocumentKind,
  type OccupancyRegisterState,
  type ReviewRecommendation,
} from '@/lib/occupancy';
import { cn } from '@/lib/utils';
import { DocLink, HistoryCard, Item, Prose, dayValue, fmtDate, postForm, reportError, selectClass } from '@/features/proceedings/shared';
import type { Offer } from '@/features/proceedings/types';
import type { ApplicationOccupancyPayload, OccupancyInspectionView } from './types';

type Step = 'submit' | 'schedule' | 'inspect' | 'recommend' | 'shortfall' | 'respond' | 'decide' | 'issue';

const EVENT_LABEL: Record<string, string> = {
  SUBMITTED: 'Completion intimated — occupancy applied for',
  INSPECTION_SCHEDULED: 'Final inspection scheduled',
  INSPECTED: 'Final inspection recorded',
  RECOMMENDED: 'As-built reviewed — recommendation made',
  SHORTFALL_RAISED: 'Shortfall raised',
  SHORTFALL_ANSWERED: 'Shortfall answered',
  APPROVED: 'Occupancy approved',
  REJECTED: 'Occupancy rejected',
  CERTIFICATE_ISSUED: 'Occupancy certificate issued',
};
const stateLabel = (s: string) => OCCUPANCY_STATE_LABEL[s as OccupancyRegisterState] ?? s;
const fig = (v: number | null | undefined, unit: string) =>
  v == null ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;

/**
 * One file's occupancy: the path, the completion intimation, the final
 * inspection, the as-built review against the approved plan, the
 * recommendation and decision, and the certificate. Rendered on the
 * Occupancy detail page and as the application's tab.
 */
export function OccupancyPanel({ initial, showApplicationLink }: { initial: ApplicationOccupancyPayload; showApplicationLink?: boolean }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [open, setOpen] = React.useState<Step | null>(null);
  const occ = data.occupancy;
  const p = data.permissions;

  const reload = async () => {
    setOpen(null);
    setData(await api.get<ApplicationOccupancyPayload>(`/api/applications/${data.application.id}/occupancy`));
    router.refresh();
  };

  const buttons: Array<{ step: Step; offer: Offer; label: string; icon: React.ReactNode; primary?: boolean }> = [
    { step: 'submit', offer: p.submit, label: 'Intimate completion', icon: <Send className="size-4" />, primary: true },
    { step: 'schedule', offer: p.schedule, label: 'Schedule final inspection', icon: <ClipboardCheck className="size-4" />, primary: true },
    { step: 'inspect', offer: p.inspect, label: 'Record final inspection', icon: <ClipboardCheck className="size-4" />, primary: true },
    { step: 'recommend', offer: p.recommend, label: 'Recommend', icon: <Ruler className="size-4" />, primary: true },
    { step: 'shortfall', offer: p.shortfall, label: 'Raise shortfall', icon: <FileWarning className="size-4" /> },
    { step: 'respond', offer: p.respond, label: 'Answer shortfall', icon: <Send className="size-4" />, primary: true },
    { step: 'decide', offer: p.approve.offered ? p.approve : p.reject, label: 'Decide', icon: <Gavel className="size-4" />, primary: true },
    { step: 'issue', offer: p.issue, label: 'Issue certificate', icon: <Award className="size-4" />, primary: true },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Building2 className="size-4" /> Occupancy <StatusBadge kind="occupancy" status={data.state} />
              {occ && occ.round > 1 && <Badge tone="outline">Round {occ.round}</Badge>}
            </CardTitle>
            <CardDescription>
              {showApplicationLink ? (
                <Link href={`/applications/${data.application.id}?tab=occupancy`} className="text-primary hover:underline">
                  {data.application.applicationNumber}
                </Link>
              ) : (
                data.application.applicationNumber
              )}{' '}
              · {data.application.zone || 'No zone'} · <StatusBadge status={data.application.status} />
              {occ && ` · next: ${occ.currentDesk}`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {buttons.map((b) => (
              <StepButton key={b.step} {...b} onClick={() => setOpen(b.step)} />
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Path data={data} />
          {!occ && data.blocker && (
            <p className="flex items-start gap-1.5 text-small text-text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" /> {data.blocker}
            </p>
          )}
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-4">
            <Item label="BPO">
              {data.order ? (
                <DocLink href={`/api/orders/${data.order.id}/pdf`}>{data.order.orderNumber}</DocLink>
              ) : (
                '—'
              )}
            </Item>
            <Item label="Work commenced">
              {data.commencement ? `${fmtDate(data.commencement.commencementDate)} · ${data.commencement.commencementNumber}` : '—'}
            </Item>
            <Item label="Owner">{data.owner || '—'}</Item>
            <Item label="LTP">
              {data.ltp.name} · {data.ltp.licenceNo || 'no licence'}
            </Item>
          </dl>
        </CardContent>
      </Card>

      {occ && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Completion intimation — {occ.occupancyNumber}</CardTitle>
              <CardDescription>Given by the technical professional on the owner’s behalf with the occupancy application.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-4">
                <Item label="Completion date">{fmtDate(occ.completionDate)}</Item>
                <Item label="Submitted">{`${fmtDate(occ.submittedAt)} · ${occ.submittedByName}`}</Item>
                <Item label="BPO">{occ.orderNumber}</Item>
                <Item label="Commencement">{occ.commencementNumber ? `${occ.commencementNumber} · ${fmtDate(occ.commencementDate)}` : '—'}</Item>
              </dl>
              <div className="grid gap-x-6 gap-y-1.5 text-small sm:grid-cols-2">
                {OCCUPANCY_DOCUMENTS.map((kind) => {
                  const idx = occ.documents.map((d, i) => (d.kind === kind ? i : -1)).filter((i) => i >= 0);
                  return (
                    <div key={kind} className="flex items-start justify-between gap-3 border-b border-border py-1.5">
                      <span className="text-text-muted">{OCCUPANCY_DOCUMENT_LABEL[kind]}</span>
                      <span className="text-right">
                        {idx.length ? (
                          idx.map((i) => (
                            <span key={i} className="block">
                              <DocLink href={`/api/applications/${data.application.id}/occupancy/document?index=${i}`}>
                                {occ.documents[i]!.isDemo ? 'Demo placeholder' : occ.documents[i]!.fileName}
                                {occ.documents[i]!.round > 1 ? ` (round ${occ.documents[i]!.round})` : ''}
                              </DocLink>
                            </span>
                          ))
                        ) : (
                          <span className="text-text-muted">Not provided</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              {occ.completionRemarks && <Prose label="Remarks">{occ.completionRemarks}</Prose>}
            </CardContent>
          </Card>

          {occ.inspections.map((i) => (
            <InspectionCard key={i.id} inspection={i} applicationId={data.application.id} />
          ))}

          <AsBuiltCard rows={occ.comparison} source={occ.asBuiltSource} />

          {(occ.recommendation || occ.shortfall || occ.decision) && (
            <Card>
              <CardHeader>
                <CardTitle>Recommendation and decision</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-small">
                {occ.shortfall && (
                  <div className="rounded border border-danger/40 bg-danger/5 px-3 py-2">
                    <p className="font-medium text-text">
                      Shortfall raised by {occ.shortfall.raisedByName} · {fmtDate(occ.shortfall.raisedAt)}
                    </p>
                    <ul className="mt-1 list-disc pl-5">
                      {occ.shortfall.items.map((it, k) => (
                        <li key={k}>{it}</li>
                      ))}
                    </ul>
                    {occ.shortfall.remarks && <p className="mt-1 text-text-muted">{occ.shortfall.remarks}</p>}
                    {occ.shortfall.response && (
                      <p className="mt-2">
                        <span className="font-medium">Answered {fmtDate(occ.shortfall.respondedAt)}:</span> {occ.shortfall.response}
                      </p>
                    )}
                  </div>
                )}
                {occ.recommendation && (
                  <Prose label={`${REVIEW_RECOMMENDATION_LABEL[occ.recommendation as ReviewRecommendation] ?? occ.recommendation} — ${occ.reviewedByName}, ${fmtDate(occ.reviewedAt)}`}>
                    {occ.recommendationNotes}
                  </Prose>
                )}
                {occ.decision && (
                  <Prose label={`${occ.decision === 'APPROVED' ? 'Approved' : 'Rejected'} — ${occ.decidedByName}, ${fmtDate(occ.decidedAt)}`}>{occ.decisionRemarks}</Prose>
                )}
              </CardContent>
            </Card>
          )}

          {occ.certificate && (
            <Card className="border-success/40">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Award className="size-4" /> Occupancy certificate {occ.certificate.certificateNumber}
                    {occ.certificate.isDemo && <Badge tone="warning">Demo</Badge>}
                  </CardTitle>
                  <CardDescription>
                    Issued {fmtDate(occ.certificate.issuedAt)} by {occ.certificate.issuedByName}. Sent to the Outward register for dispatch.
                  </CardDescription>
                </div>
                <Button asChild variant="primary">
                  <a href={`/api/applications/${data.application.id}/occupancy/certificate`} target="_blank" rel="noreferrer">
                    Open PDF
                  </a>
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-4">
                  <Item label="Certificate number">{occ.certificate.certificateNumber}</Item>
                  <Item label="Issue date">{fmtDate(occ.certificate.issuedAt)}</Item>
                  <Item label="Approved area">{fig(occ.certificate.approvedAreaSqm, 'sq m')}</Item>
                  <Item label="Completed area">{fig(occ.certificate.completedAreaSqm, 'sq m')}</Item>
                  <Item label="Application">{data.application.applicationNumber}</Item>
                  <Item label="BPO">{occ.orderNumber}</Item>
                  <Item label="Outward number">
                    {occ.certificate.outwardEntryId ? (
                      <Link href={`/outward/${occ.certificate.outwardEntryId}`} className="text-primary hover:underline">
                        {occ.certificate.outwardNumber}
                      </Link>
                    ) : (
                      occ.certificate.outwardNumber || '—'
                    )}
                  </Item>
                </dl>
                <div className="text-small">
                  <p className="mb-1 text-caption font-medium uppercase tracking-wide text-text-muted">Conditions</p>
                  <ol className="list-decimal space-y-0.5 pl-5">
                    {occ.certificate.conditions.map((c, k) => (
                      <li key={k}>{c}</li>
                    ))}
                  </ol>
                </div>
              </CardContent>
            </Card>
          )}

          <HistoryCard events={occ.events} label={EVENT_LABEL} statusLabel={stateLabel} />
        </>
      )}

      {data.history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Earlier occupancy applications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-small">
            {data.history.map((h) => (
              <p key={h.id}>
                {h.occupancyNumber} · <StatusBadge kind="occupancy" status={h.status} /> · submitted {fmtDate(h.submittedAt)}
                {h.decisionRemarks ? ` — ${h.decisionRemarks}` : ''}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {open === 'submit' && <SubmitDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'schedule' && <ScheduleDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'inspect' && <InspectDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'recommend' && <RecommendDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'shortfall' && <ShortfallDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'respond' && <RespondDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'decide' && <DecideDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'issue' && <IssueDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
    </div>
  );
}

function StepButton({ offer, label, icon, primary, onClick }: { offer: Offer; label: string; icon: React.ReactNode; primary?: boolean; onClick: () => void }) {
  if (!offer.offered) return null;
  if (offer.available) {
    return (
      <Button variant={primary ? 'primary' : 'secondary'} onClick={onClick}>
        {icon} {label}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button variant="secondary" disabled>
            {icon} {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{offer.reason}</TooltipContent>
    </Tooltip>
  );
}

/** Completion → Submission → Final inspection → As-built review → Recommendation → Certificate. */
function Path({ data }: { data: ApplicationOccupancyPayload }) {
  const s = data.occupancy?.status ?? '';
  const reached = (...statuses: string[]) => statuses.includes(s);
  const steps = [
    { label: 'Completion intimation', done: Boolean(data.occupancy) },
    { label: 'Occupancy submission', done: Boolean(data.occupancy) },
    { label: 'Final inspection', done: reached('INSPECTION_COMPLETED', 'RECOMMENDED', 'APPROVED', 'CERTIFICATE_ISSUED', 'REJECTED') || (s === 'SHORTFALL' && Boolean(data.occupancy?.inspections.some((i) => i.status === 'COMPLETED'))) },
    { label: 'As-built review', done: reached('RECOMMENDED', 'APPROVED', 'CERTIFICATE_ISSUED', 'REJECTED') },
    { label: 'Recommendation', done: reached('RECOMMENDED', 'APPROVED', 'CERTIFICATE_ISSUED', 'REJECTED') },
    { label: 'Occupancy certificate', done: reached('CERTIFICATE_ISSUED') },
  ];
  return (
    <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {steps.map((st, i) => (
        <li key={st.label} className={cn('flex items-center gap-2 rounded border px-2.5 py-2', st.done ? 'border-success/40 bg-success/5' : 'border-border bg-surface-sunk')}>
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full text-caption',
              st.done ? 'bg-success text-white' : 'border border-border-strong text-text-muted'
            )}
          >
            {st.done ? <Check className="size-3" /> : i + 1}
          </span>
          <span className="text-small font-medium text-text">{st.label}</span>
        </li>
      ))}
    </ol>
  );
}

function InspectionCard({ inspection: i, applicationId }: { inspection: OccupancyInspectionView; applicationId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ClipboardCheck className="size-4" /> Final inspection — round {i.round}
          {i.recommendation && <Badge tone={i.recommendation === 'RECOMMENDED' ? 'success' : i.recommendation === 'SHORTFALL' ? 'warning' : 'danger'}>{INSPECTION_RECOMMENDATION_LABEL[i.recommendation as InspectionRecommendation]}</Badge>}
        </CardTitle>
        <CardDescription>
          {i.status === 'COMPLETED'
            ? `Inspected ${fmtDate(i.inspectedAt)} by ${i.inspectorName}.`
            : `Scheduled for ${fmtDate(i.scheduledFor)} with ${i.inspectorName} (booked by ${i.scheduledByName}).`}
        </CardDescription>
      </CardHeader>
      {i.status === 'COMPLETED' && (
        <CardContent className="space-y-3">
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2">
            <Item label="Inspection date">{fmtDate(i.inspectedAt)}</Item>
            <Item label="Inspector">{i.inspectorName}</Item>
            <Item label="Site condition">{i.siteCondition}</Item>
            <Item label="Actual construction">{i.actualConstruction}</Item>
            <Item label="Approved construction">{i.approvedConstruction || '—'}</Item>
            <Item label="Deviations">{i.deviations || 'None recorded'}</Item>
          </dl>
          {i.remarks && <Prose label="Remarks">{i.remarks}</Prose>}
          {i.photos.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {i.photos.map((ph, k) => (
                <a key={k} href={`/api/applications/${applicationId}/occupancy/photo?round=${i.round}&index=${k}`} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/applications/${applicationId}/occupancy/photo?round=${i.round}&index=${k}`}
                    alt={OCCUPANCY_PHOTO_LABEL[ph.view]}
                    className="aspect-[16/11] w-full rounded border border-border object-cover"
                  />
                  <span className="text-caption text-text-muted">
                    {OCCUPANCY_PHOTO_LABEL[ph.view]}
                    {ph.isDemo ? ' · demo' : ''}
                  </span>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/** Approved vs as built, parameter by parameter. */
function AsBuiltCard({ rows, source }: { rows: ComparisonRow[]; source: string }) {
  const deviations = rows.filter((r) => r.verdict === 'DEVIATION').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Ruler className="size-4" /> As-built review
          {source === 'DEMO' && <Badge tone="warning">Demo as-built figures</Badge>}
          {source && (deviations ? <Badge tone="danger">{deviations} deviation{deviations === 1 ? '' : 's'}</Badge> : <Badge tone="success">Within tolerance</Badge>)}
        </CardTitle>
        <CardDescription>
          Approved figures from the building permission order; as-built figures from the final inspection. A difference beyond 2 % (floors: any) the wrong way is a
          deviation — a demonstration tolerance, not a published one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-small">
            <thead>
              <tr className="border-b border-border text-left text-caption text-text-muted">
                <th className="py-1.5 pr-3 font-medium">Parameter</th>
                <th className="py-1.5 pr-3 font-medium">Approved</th>
                <th className="py-1.5 pr-3 font-medium">As built</th>
                <th className="py-1.5 pr-3 font-medium">Difference</th>
                <th className="py-1.5 pr-3 font-medium">Finding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3 text-text-muted">{r.label}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{fig(r.approved, r.unit)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{fig(r.asBuilt, r.unit)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {r.difference == null ? '—' : `${r.difference > 0 ? '+' : ''}${fig(r.difference, r.unit)}${r.differencePercent != null ? ` (${r.differencePercent > 0 ? '+' : ''}${r.differencePercent} %)` : ''}`}
                  </td>
                  <td className="py-1.5 pr-3">
                    {r.verdict === 'DEVIATION' ? (
                      <span className="font-medium text-danger">Deviation</span>
                    ) : r.verdict === 'WITHIN' ? (
                      <span className="text-success">Within</span>
                    ) : (
                      <span className="text-text-muted">Not recorded</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Dialogs
// ═══════════════════════════════════════════════════════════════════════════

type DialogProps = { data: ApplicationOccupancyPayload; onClose: () => void; onDone: () => Promise<void> };

function Shell({
  title,
  description,
  onClose,
  busy,
  disabled,
  action,
  onSubmit,
  destructive,
  wide,
  children,
}: {
  title: string;
  description: React.ReactNode;
  onClose: () => void;
  busy: boolean;
  disabled: boolean;
  action: string;
  onSubmit: () => void;
  destructive?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={wide ? 'max-w-3xl' : 'max-w-lg'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">{children}</DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onSubmit} loading={busy} disabled={busy || disabled}>
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useSubmit(onDone: () => Promise<void>, success: string) {
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      toast.success(success);
      await onDone();
    } catch (error) {
      setErrors(reportError(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, run };
}

function DocumentInputs({
  files,
  setFiles,
  demo,
  setDemo,
  demoAllowed,
  required,
}: {
  files: Partial<Record<OccupancyDocumentKind, File>>;
  setFiles: (f: Partial<Record<OccupancyDocumentKind, File>>) => void;
  demo: OccupancyDocumentKind[];
  setDemo: (d: OccupancyDocumentKind[]) => void;
  demoAllowed: boolean;
  required: readonly OccupancyDocumentKind[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-caption text-text-muted">PDF or image, 10 MB each.</p>
      {OCCUPANCY_DOCUMENTS.map((kind) => (
        <div key={kind} className="grid items-center gap-1 sm:grid-cols-[14rem_1fr]">
          <label htmlFor={`oc-doc-${kind}`} className="text-small text-text">
            {OCCUPANCY_DOCUMENT_LABEL[kind]}
            {required.includes(kind) && <span className="text-danger"> *</span>}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input id={`oc-doc-${kind}`} type="file" accept=".pdf,.png,.jpg,.jpeg" className="block max-w-[14rem] text-small" onChange={(e) => setFiles({ ...files, [kind]: e.target.files?.[0] })} />
            {demoAllowed && !files[kind] && (
              <label className="flex items-center gap-1.5 text-caption text-text-muted">
                <Checkbox checked={demo.includes(kind)} onChange={(e) => setDemo(e.target.checked ? [...demo, kind] : demo.filter((k) => k !== kind))} />
                Demo placeholder
              </label>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SubmitDialog({ data, onClose, onDone }: DialogProps) {
  const [date, setDate] = React.useState(dayValue(0));
  const [remarks, setRemarks] = React.useState('');
  const [files, setFiles] = React.useState<Partial<Record<OccupancyDocumentKind, File>>>({});
  const [demo, setDemo] = React.useState<OccupancyDocumentKind[]>([]);
  const { busy, errors, run } = useSubmit(onDone, 'Completion intimated — occupancy applied for');
  const haveRequired = REQUIRED_OCCUPANCY_DOCUMENTS.every((k) => files[k] || demo.includes(k));
  const submit = () =>
    run(() => {
      const form = new FormData();
      form.set('completionDate', date);
      form.set('remarks', remarks);
      for (const [k, f] of Object.entries(files)) if (f) form.set(`doc_${k}`, f);
      if (demo.length) {
        form.set('demoDocuments', 'true');
        form.set('demoKinds', demo.join(','));
      }
      return postForm(`/api/applications/${data.application.id}/occupancy`, form);
    });
  return (
    <Shell
      title={`Intimate completion — ${data.application.applicationNumber}`}
      description={`Under ${data.order?.orderNumber ?? 'the BPO'}${data.commencement ? `, work commenced ${fmtDate(data.commencement.commencementDate)}` : ''}. This applies for occupancy; the department then inspects the building.`}
      onClose={onClose}
      busy={busy}
      disabled={!date || !haveRequired}
      action="Submit for occupancy"
      onSubmit={submit}
      wide
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Application" htmlFor="oc-app">
          <Input id="oc-app" value={data.application.applicationNumber} disabled />
        </Field>
        <Field label="Owner" htmlFor="oc-owner">
          <Input id="oc-owner" value={data.owner} disabled />
        </Field>
        <Field label="LTP" htmlFor="oc-ltp">
          <Input id="oc-ltp" value={data.ltp.name} disabled />
        </Field>
        <Field label="Completion date" htmlFor="oc-date" required error={errors.completionDate}>
          <Input id="oc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Remarks" htmlFor="oc-remarks">
        <Textarea id="oc-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <DocumentInputs files={files} setFiles={setFiles} demo={demo} setDemo={setDemo} demoAllowed={data.permissions.demoAllowed} required={REQUIRED_OCCUPANCY_DOCUMENTS} />
    </Shell>
  );
}

function ScheduleDialog({ data, onClose, onDone }: DialogProps) {
  const [date, setDate] = React.useState(dayValue(2));
  const [inspectorId, setInspectorId] = React.useState(data.inspectors[0]?.id ?? '');
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, 'Final inspection scheduled');
  return (
    <Shell
      title={`Schedule final inspection — ${data.occupancy?.occupancyNumber}`}
      description={`Completion was intimated for ${fmtDate(data.occupancy?.completionDate)}.`}
      onClose={onClose}
      busy={busy}
      disabled={!date || !inspectorId}
      action="Schedule"
      onSubmit={() =>
        run(() => api.post(`/api/applications/${data.application.id}/occupancy/schedule`, { scheduledFor: date, inspectorId, remarks, expectedStatus: data.occupancy?.status }))
      }
    >
      <Field label="Inspection date" htmlFor="oc-sched" required error={errors.scheduledFor}>
        <Input id="oc-sched" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Inspector" htmlFor="oc-insp" required error={errors.inspectorId}>
        <select id="oc-insp" className={`${selectClass} w-full`} value={inspectorId} onChange={(e) => setInspectorId(e.target.value)}>
          <option value="">Choose…</option>
          {data.inspectors.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.designation ? ` — ${u.designation}` : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Remarks" htmlFor="oc-sched-r">
        <Textarea id="oc-sched-r" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}

function InspectDialog({ data, onClose, onDone }: DialogProps) {
  const occ = data.occupancy!;
  const [form, setForm] = React.useState({
    inspectionDate: dayValue(0),
    siteCondition: '',
    actualConstruction: '',
    approvedConstruction: approvedSummary(occ.comparison),
    deviations: '',
    remarks: '',
  });
  const [recommendation, setRecommendation] = React.useState<InspectionRecommendation>('RECOMMENDED');
  const [asBuilt, setAsBuilt] = React.useState<Partial<Record<AsBuiltKey, string>>>({});
  const [demoAsBuilt, setDemoAsBuilt] = React.useState(false);
  const [variant, setVariant] = React.useState<'COMPLIANT' | 'DEVIATION'>('COMPLIANT');
  const [demoPhotos, setDemoPhotos] = React.useState(false);
  const { busy, errors, run } = useSubmit(onDone, 'Final inspection recorded');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const anyFigure = Object.values(asBuilt).some((v) => v && v.trim());
  const submit = () =>
    run(() => {
      const f = new FormData();
      for (const [k, v] of Object.entries(form)) f.set(k, v);
      f.set('recommendation', recommendation);
      f.set('asBuilt', JSON.stringify(Object.fromEntries(Object.entries(asBuilt).filter(([, v]) => v && v.trim()))));
      if (demoAsBuilt) {
        f.set('demoAsBuilt', 'true');
        f.set('demoVariant', variant);
      }
      if (demoPhotos) f.set('demoPhotos', 'true');
      f.set('expectedStatus', occ.status);
      return postForm(`/api/applications/${data.application.id}/occupancy/inspect`, f);
    });
  return (
    <Shell
      title={`Record final inspection — ${occ.occupancyNumber}`}
      description="What was found on site, measured against the approved plan. A Shortfall recommendation returns the application to the applicant."
      onClose={onClose}
      busy={busy}
      disabled={form.siteCondition.trim().length < 3 || form.actualConstruction.trim().length < 3 || form.remarks.trim().length < 3 || (!anyFigure && !demoAsBuilt)}
      action="Record inspection"
      onSubmit={submit}
      wide
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Inspection date" htmlFor="oi-date" required error={errors.inspectionDate}>
          <Input id="oi-date" type="date" value={form.inspectionDate} onChange={set('inspectionDate')} />
        </Field>
        <Field label="Inspector" htmlFor="oi-inspector">
          <Input id="oi-inspector" value={occ.inspections.at(-1)?.inspectorName ?? ''} disabled />
        </Field>
      </div>
      <Field label="Site condition" htmlFor="oi-site" required error={errors.siteCondition}>
        <Textarea id="oi-site" rows={2} value={form.siteCondition} onChange={set('siteCondition')} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Actual construction" htmlFor="oi-actual" required error={errors.actualConstruction}>
          <Textarea id="oi-actual" rows={3} value={form.actualConstruction} onChange={set('actualConstruction')} />
        </Field>
        <Field label="Approved construction" htmlFor="oi-approved">
          <Textarea id="oi-approved" rows={3} value={form.approvedConstruction} onChange={set('approvedConstruction')} />
        </Field>
      </div>
      <Field label="Deviations" htmlFor="oi-dev" hint="One per line. With a Shortfall recommendation, each line becomes a shortfall item.">
        <Textarea id="oi-dev" rows={3} value={form.deviations} onChange={set('deviations')} />
      </Field>

      <fieldset className="space-y-1.5 rounded border border-border p-3">
        <legend className="px-1 text-small font-medium">As-built figures</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {AS_BUILT_PARAMETERS.map((p) => {
            const approved = occ.comparison.find((r) => r.key === p.key)?.approved;
            return (
              <label key={p.key} className="grid grid-cols-[1fr_7rem] items-center gap-2 text-small">
                <span>
                  {p.label}
                  <span className="block text-caption text-text-muted">approved {fig(approved, p.unit)}</span>
                </span>
                <Input inputMode="decimal" value={asBuilt[p.key] ?? ''} onChange={(e) => setAsBuilt({ ...asBuilt, [p.key]: e.target.value })} aria-label={`${p.label} as built`} />
              </label>
            );
          })}
        </div>
        {data.permissions.demoAllowed && (
          <div className="flex flex-wrap items-center gap-3 pt-1 text-caption text-text-muted">
            <label className="flex items-center gap-1.5">
              <Checkbox checked={demoAsBuilt} onChange={(e) => setDemoAsBuilt(e.target.checked)} /> Fill blanks with demo figures
            </label>
            {demoAsBuilt && (
              <select aria-label="Demo pattern" className={selectClass} value={variant} onChange={(e) => setVariant(e.target.value as 'COMPLIANT' | 'DEVIATION')}>
                <option value="COMPLIANT">Built as approved</option>
                <option value="DEVIATION">With deviations</option>
              </select>
            )}
          </div>
        )}
      </fieldset>

      {data.permissions.demoAllowed && (
        <label className="flex items-center gap-1.5 text-small text-text-muted">
          <Checkbox checked={demoPhotos} onChange={(e) => setDemoPhotos(e.target.checked)} /> Attach labelled demo photographs (six views)
        </label>
      )}

      <fieldset className="space-y-1.5">
        <legend className="text-small font-medium">Recommendation</legend>
        <div className="flex flex-wrap gap-2">
          {INSPECTION_RECOMMENDATIONS.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-1.5 text-small has-[:checked]:border-primary">
              <input type="radio" name="oi-rec" checked={recommendation === r} onChange={() => setRecommendation(r)} />
              {INSPECTION_RECOMMENDATION_LABEL[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Remarks" htmlFor="oi-remarks" required error={errors.remarks}>
        <Textarea id="oi-remarks" rows={2} value={form.remarks} onChange={set('remarks')} />
      </Field>
    </Shell>
  );
}

function approvedSummary(rows: ComparisonRow[]) {
  const v = (k: string) => rows.find((r) => r.key === k);
  const parts = [
    v('floors')?.approved != null ? `${v('floors')!.approved} floors` : '',
    v('builtUpAreaSqm')?.approved != null ? `${fig(v('builtUpAreaSqm')!.approved, 'sq m')} built-up` : '',
    v('heightM')?.approved != null ? `${fig(v('heightM')!.approved, 'm')} high` : '',
  ].filter(Boolean);
  return parts.length ? `As sanctioned: ${parts.join(', ')}.` : '';
}

function RecommendDialog({ data, onClose, onDone }: DialogProps) {
  const occ = data.occupancy!;
  const inspection = occ.inspections.at(-1);
  const [recommendation, setRecommendation] = React.useState<ReviewRecommendation>(inspection?.recommendation === 'REJECT' ? 'REJECT' : 'APPROVE');
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, 'Recommendation recorded — sent for decision');
  const deviations = occ.comparison.filter((r) => r.verdict === 'DEVIATION');
  return (
    <Shell
      title={`As-built review — ${occ.occupancyNumber}`}
      description={`The inspector recommended: ${inspection ? INSPECTION_RECOMMENDATION_LABEL[inspection.recommendation as InspectionRecommendation] : '—'}. ${deviations.length ? `${deviations.length} parameter(s) deviate from the approved plan: ${deviations.map((d) => d.label).join(', ')}.` : 'Every recorded parameter is within tolerance.'}`}
      onClose={onClose}
      busy={busy}
      disabled={remarks.trim().length < 5}
      action="Send recommendation"
      onSubmit={() => run(() => api.post(`/api/applications/${data.application.id}/occupancy/recommend`, { recommendation, remarks, expectedStatus: occ.status }))}
    >
      <fieldset className="space-y-2">
        {(['APPROVE', 'REJECT'] as const).map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-2 text-small has-[:checked]:border-primary">
            <input type="radio" name="oc-rec" checked={recommendation === r} onChange={() => setRecommendation(r)} />
            {REVIEW_RECOMMENDATION_LABEL[r]}
          </label>
        ))}
      </fieldset>
      <Field label="Remarks" htmlFor="oc-rec-r" required error={errors.remarks} hint="Your review of the as-built building against the approved plan.">
        <Textarea id="oc-rec-r" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}

function ShortfallDialog({ data, onClose, onDone }: DialogProps) {
  const occ = data.occupancy!;
  const [items, setItems] = React.useState(
    occ.comparison
      .filter((r) => r.verdict === 'DEVIATION')
      .map((r) => `${r.label}: approved ${fig(r.approved, r.unit)}, as built ${fig(r.asBuilt, r.unit)} — rectify or regularise.`)
      .join('\n')
  );
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, 'Shortfall raised — returned to the applicant');
  const list = items.split('\n').map((s) => s.trim()).filter((s) => s.length >= 3);
  return (
    <Shell
      title={`Raise occupancy shortfall — ${occ.occupancyNumber}`}
      description="The applicant answers, and the building is inspected again."
      onClose={onClose}
      busy={busy}
      disabled={!list.length || remarks.trim().length < 5}
      action="Raise shortfall"
      destructive
      onSubmit={() => run(() => api.post(`/api/applications/${data.application.id}/occupancy/shortfall`, { items: list, remarks, expectedStatus: occ.status }))}
    >
      <Field label="Items" htmlFor="oc-sf-items" required hint="One per line." error={errors.items}>
        <Textarea id="oc-sf-items" rows={4} value={items} onChange={(e) => setItems(e.target.value)} />
      </Field>
      <Field label="Remarks" htmlFor="oc-sf-r" required error={errors.remarks}>
        <Textarea id="oc-sf-r" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}

function RespondDialog({ data, onClose, onDone }: DialogProps) {
  const occ = data.occupancy!;
  const [remarks, setRemarks] = React.useState('');
  const [files, setFiles] = React.useState<Partial<Record<OccupancyDocumentKind, File>>>({});
  const [demo, setDemo] = React.useState<OccupancyDocumentKind[]>([]);
  const { busy, errors, run } = useSubmit(onDone, 'Shortfall answered — the building will be inspected again');
  return (
    <Shell
      title={`Answer shortfall — ${occ.occupancyNumber}`}
      description={
        <>
          The department asked:
          <ul className="mt-1 list-disc pl-5">
            {occ.shortfall?.items.map((it, k) => (
              <li key={k}>{it}</li>
            ))}
          </ul>
        </>
      }
      onClose={onClose}
      busy={busy}
      disabled={remarks.trim().length < 10}
      action="Submit answer"
      wide
      onSubmit={() =>
        run(() => {
          const f = new FormData();
          f.set('remarks', remarks);
          for (const [k, file] of Object.entries(files)) if (file) f.set(`doc_${k}`, file);
          if (demo.length) {
            f.set('demoDocuments', 'true');
            f.set('demoKinds', demo.join(','));
          }
          f.set('expectedStatus', occ.status);
          return postForm(`/api/applications/${data.application.id}/occupancy/respond`, f);
        })
      }
    >
      <Field label="What was put right" htmlFor="oc-resp" required error={errors.remarks}>
        <Textarea id="oc-resp" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <DocumentInputs files={files} setFiles={setFiles} demo={demo} setDemo={setDemo} demoAllowed={data.permissions.demoAllowed} required={[]} />
    </Shell>
  );
}

function DecideDialog({ data, onClose, onDone }: DialogProps) {
  const occ = data.occupancy!;
  const [decision, setDecision] = React.useState<'APPROVED' | 'REJECTED'>(occ.recommendation === 'REJECT' ? 'REJECTED' : 'APPROVED');
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, decision === 'APPROVED' ? 'Occupancy approved' : 'Occupancy rejected');
  const allowed = { APPROVED: data.permissions.approve.available, REJECTED: data.permissions.reject.available };
  return (
    <Shell
      title={`Decide occupancy — ${occ.occupancyNumber}`}
      description={`${occ.recommendationLabel} by ${occ.reviewedByName}. Approving lets the certificate be issued.`}
      onClose={onClose}
      busy={busy}
      disabled={remarks.trim().length < 5 || !allowed[decision]}
      action={decision === 'APPROVED' ? 'Approve occupancy' : 'Reject occupancy'}
      destructive={decision === 'REJECTED'}
      onSubmit={() => run(() => api.post(`/api/applications/${data.application.id}/occupancy/decide`, { decision, remarks, expectedStatus: occ.status }))}
    >
      <fieldset className="space-y-2">
        {(['APPROVED', 'REJECTED'] as const).map((d) => (
          <label key={d} className="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-2 text-small has-[:checked]:border-primary">
            <input type="radio" name="oc-decide" checked={decision === d} onChange={() => setDecision(d)} disabled={!allowed[d]} />
            {d === 'APPROVED' ? 'Approve occupancy' : 'Reject occupancy'}
          </label>
        ))}
      </fieldset>
      <Field label="Remarks" htmlFor="oc-dec-r" required error={errors.remarks}>
        <Textarea id="oc-dec-r" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}

function IssueDialog({ data, onClose, onDone }: DialogProps) {
  const occ = data.occupancy!;
  const [remarks, setRemarks] = React.useState('');
  const { busy, run } = useSubmit(onDone, 'Occupancy certificate issued — sent to Outward');
  return (
    <Shell
      title={`Issue occupancy certificate — ${occ.occupancyNumber}`}
      description="Numbers the certificate, freezes what it certifies, and places it in the Outward register ready for dispatch. It cannot be re-issued."
      onClose={onClose}
      busy={busy}
      disabled={false}
      action="Issue certificate"
      onSubmit={() => run(() => api.post(`/api/applications/${data.application.id}/occupancy/issue`, { remarks, expectedStatus: occ.status }))}
    >
      <Field label="Remarks" htmlFor="oc-issue-r">
        <Textarea id="oc-issue-r" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}
