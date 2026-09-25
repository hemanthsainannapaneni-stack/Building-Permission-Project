import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { can } from '@/server/auth/context';
import { getApplication, getApplicationMeta, getTimeline } from '@/server/services/applications';
import { listDrawings, drawingCategories } from '@/server/services/drawings';
import { getBim } from '@/server/services/bim';
import { getScrutiny } from '@/server/services/scrutiny';
import { getDocuments, documentTypes } from '@/server/services/documents';
import { getFees } from '@/server/services/fees';
import { getPayments } from '@/server/services/payments';
import { getApplicationChecklist } from '@/server/services/application-checklist';
import { getApplicationOthers } from '@/server/services/application-others';
import { getApplicationInspections } from '@/server/services/site-inspections';
import { getApplicationNocs } from '@/server/services/nocs';
import { getApplicationProceedings } from '@/server/services/show-cause';
import { getApplicationProfessional } from '@/server/services/professional-changes';
import { getApplicationCommencement } from '@/server/services/work-commencements';
import { getApplicationOccupancy } from '@/server/services/occupancy';
import { getWorkflowState, getHistory, getShortfalls } from '@/server/workflow/engine';
import { applicationAudit } from '@/server/services/audit';
import { openShortfallsFor } from '@/server/shortfalls/queries';
import { getApprovalOrder } from '@/server/services/approval-orders';
import { isLtp } from '@/server/auth/context';
import { env } from '@/server/config/env';
import { isApiError } from '@/server/http/errors';
import { serialize } from '@/server/http/serialize';
import { ApplicationDetailView } from '@/features/applications/application-detail';
import type {
  ApplicationDetail,
  ApplicationMeta,
  TimelineEvent,
} from '@/features/applications/types';
import type { ChecklistPayload } from '@/features/checklist/types';
import type { OthersPayload } from '@/features/others/types';
import type { ApplicationInspectionsPayload } from '@/features/inspections/types';
import type { ApplicationNocsPayload } from '@/features/nocs/types';
import type { ApplicationProceedingsPayload } from '@/features/proceedings/types';
import type { ApplicationProfessionalPayload } from '@/features/professional-change/types';
import type { ApplicationCommencementPayload } from '@/features/commencement/types';
import type { ApplicationOccupancyPayload } from '@/features/occupancy/types';
import type { DrawingsPayload, ScrutinyPayload } from '@/features/drawings/types';
import type { BimPayload } from '@/features/bim/types';
import type { DocumentsPayload } from '@/features/documents/types';
import type { FeesPayload } from '@/features/fees/types';
import type { PaymentsPayload } from '@/features/payments/types';
import type { OrderView } from '@/features/approvals/order-panel';
import type { HistoryEntry, Shortfall, WorkflowState } from '@/features/workflow/types';
import type { AuditRow } from '@/features/applications/audit-panel';
import type { ShortfallRow } from '@/features/shortfalls/types';

export const dynamic = 'force-dynamic';

/**
 * Loads the application once per request, however many callers ask.
 *
 * `generateMetadata` and the page body both need it, and React's `cache()`
 * means that is one query rather than two. Without it the title would have to
 * fall back to a slice of the UUID — which is no use at all to someone with
 * four applications open in four tabs, the exact situation a title exists for.
 */
const loadApplication = cache(
  async (user: Parameters<typeof getApplication>[0], id: string) => {
    try {
      return await getApplication(user, id);
    } catch (error) {
      // Not theirs and not there are the same answer — see the note below.
      if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
      throw error;
    }
  }
);

/**
 * Resolves the title — and, crucially, decides the 404 HERE rather than in the
 * page body.
 *
 * WHY THIS IS NOT JUST A TITLE. Next streams the response: once the document
 * head has been flushed, the HTTP status is already on the wire and
 * `notFound()` can no longer change it. The page body runs after that flush,
 * so a `notFound()` down there renders the right screen with a **200**, which
 * is wrong for every consumer that reads status rather than markup — uptime
 * checks, crawlers, and any client that treats 2xx as success.
 *
 * `generateMetadata` resolves BEFORE the head is emitted, so throwing from
 * here is what actually produces a 404. This was measured, not assumed: with
 * the check only in the page body the response carried
 * `NEXT_HTTP_ERROR_FALLBACK;404` in its payload and a `200` in its status
 * line. See tests/http/routes.test.ts, which pins the status so it cannot
 * regress silently.
 *
 * The `cache()` above means this costs no extra query — the page body reuses
 * the same result.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const user = await requirePageCapability(CAPABILITIES.APPLICATION_VIEW);
  const { id } = await params;
  const application = await loadApplication(user, id);

  if (!application) notFound();

  return { title: application.applicationNumber };
}

/**
 * The application record.
 *
 * `getApplication` and `getTimeline` both merge the caller's row scope into
 * their queries, so an id belonging to someone else's file is indistinguishable
 * from one that does not exist — which is the point. Both come back as a 404
 * here rather than a 403, so the page cannot be used to discover which
 * application numbers are real.
 */
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageCapability(CAPABILITIES.APPLICATION_VIEW);
  const { id } = await params;

  // Shared with generateMetadata by React's cache(), so this is one query.
  const application = await loadApplication(user, id);

  // generateMetadata has already thrown for this case — that is what makes the
  // status a real 404. Kept as the type guard, and as the backstop if metadata
  // resolution is ever skipped for this route.
  if (!application) notFound();

  // Every tab's data is fetched on the SERVER in one pass. The tab components
  // refresh themselves afterwards (scrutiny polls while a run is in flight),
  // but the first paint is complete rather than a row of spinners.
  //
  // Documents and fees are fetched only for a caller who may SEE them. That is
  // not an optimisation: DOCUMENT_VIEW and FEE_VIEW are separate grants, and
  // loading a demand for somebody whose role does not include fees would put
  // it into the page payload whether or not a tab ever rendered it.
  const [
    timeline,
    meta,
    checklist,
    others,
    drawings,
    categories,
    bim,
    scrutiny,
    documents,
    docTypes,
    fees,
    payments,
    workflow,
    history,
    shortfalls,
    auditRows,
    openShortfalls,
    order,
    inspections,
    nocs,
    proceedings,
    professional,
    commencement,
    occupancy,
  ] = await Promise.all([
    getTimeline(user, id),
    getApplicationMeta(),
    // CHECKLIST_VIEW is a grant of its own, so the checklist is fetched only
    // for a caller who may see it — not as an optimisation, but because
    // loading nineteen answers for somebody whose role excludes them would put
    // them into the page payload whether or not a tab ever rendered it.
    can(user, CAPABILITIES.CHECKLIST_VIEW) ? getApplicationChecklist(user, id) : null,
    // No capability of its own: the Others block is part of the application's
    // own particulars, and everybody who may see the file may see them.
    getApplicationOthers(user, id),
    listDrawings(user, id),
    drawingCategories(),
    can(user, CAPABILITIES.DRAWING_VIEW) ? getBim(user, id) : null,
    getScrutiny(user, id),
    can(user, CAPABILITIES.DOCUMENT_VIEW) ? getDocuments(user, id) : null,
    can(user, CAPABILITIES.DOCUMENT_VIEW) ? documentTypes() : null,
    can(user, CAPABILITIES.FEE_VIEW) ? getFees(user, id) : null,
    can(user, CAPABILITIES.PAYMENT_VIEW) ? getPayments(user, id) : null,
    // The action bar's contents are decided on the server, by the engine, in
    // the same call the POST will re-derive them from. The client renders the
    // answer and never computes one of its own.
    can(user, CAPABILITIES.WORKFLOW_VIEW) ? getWorkflowState(user, id) : null,
    can(user, CAPABILITIES.WORKFLOW_VIEW) ? getHistory(user, id) : [],
    can(user, CAPABILITIES.SHORTFALL_VIEW) ? getShortfalls(user, id) : null,
    // Row scope was proven by `loadApplication` above, which is why this can
    // read by application id alone.
    can(user, CAPABILITIES.AUDIT_VIEW) ? applicationAudit(id) : null,
    can(user, CAPABILITIES.SHORTFALL_VIEW) ? openShortfallsFor(user, id) : [],
    can(user, CAPABILITIES.ORDER_VIEW) ? getApprovalOrder(user, id) : null,
    // SITE_INSPECTION_VIEW is its own grant: the applicant does not hold it.
    can(user, CAPABILITIES.SITE_INSPECTION_VIEW) ? getApplicationInspections(user, id) : null,
    can(user, CAPABILITIES.NOC_VIEW) ? getApplicationNocs(user, id) : null,
    can(user, CAPABILITIES.SHOW_CAUSE_VIEW) ? getApplicationProceedings(user, id) : null,
    can(user, CAPABILITIES.LTP_CHANGE_VIEW) ? getApplicationProfessional(user, id) : null,
    // Post approval only: before approval the tab has nothing to show.
    can(user, CAPABILITIES.COMMENCEMENT_VIEW) && ['APPROVED', 'PROCEEDING_REVOKED'].includes(application.status)
      ? getApplicationCommencement(user, id)
      : null,
    can(user, CAPABILITIES.OCCUPANCY_VIEW) && ['APPROVED', 'PROCEEDING_REVOKED'].includes(application.status)
      ? getApplicationOccupancy(user, id)
      : null,
  ]);

  return (
    <ApplicationDetailView
      application={application as unknown as ApplicationDetail}
      timeline={timeline as unknown as TimelineEvent[]}
      meta={meta as ApplicationMeta}
      capabilities={user.capabilities}
      canEdit={can(user, CAPABILITIES.APPLICATION_EDIT)}
      canDelete={can(user, CAPABILITIES.APPLICATION_DELETE)}
      // Serialised rather than cast: both carry Date columns that the client
      // types declare as ISO strings.
      checklist={serialize(checklist) as ChecklistPayload | null}
      others={serialize(others) as OthersPayload}
      drawings={
        {
          ...drawings,
          categories,
          maxUploadBytes: env.maxUploadBytes,
        } as unknown as DrawingsPayload
      }
      bim={serialize(bim) as unknown as BimPayload | null}
      scrutiny={scrutiny as unknown as ScrutinyPayload}
      documents={
        documents
          ? ({ ...documents, types: docTypes ?? [] } as unknown as DocumentsPayload)
          : null
      }
      fees={fees as unknown as FeesPayload | null}
      // Serialised here rather than cast: the payload carries Prisma
      // `Decimal` money and `Date` columns, and `PaymentsPayload` declares
      // them as numbers and ISO strings. `serialize()` is the one function
      // that makes that true, and this prop is a server→client boundary just
      // as much as an API response is.
      payments={serialize(payments) as PaymentsPayload | null}
      canUploadDrawing={can(user, CAPABILITIES.DRAWING_UPLOAD)}
      canReviewBim={can(user, CAPABILITIES.CHECKLIST_REVIEW)}
      canRequestScrutiny={can(user, CAPABILITIES.SCRUTINY_REQUEST)}
      canUploadDocument={can(user, CAPABILITIES.DOCUMENT_UPLOAD)}
      canVerifyDocument={can(user, CAPABILITIES.DOCUMENT_VERIFY)}
      canGenerateFee={can(user, CAPABILITIES.FEE_GENERATE)}
      canInitiatePayment={can(user, CAPABILITIES.PAYMENT_INITIATE)}
      // Serialised rather than cast: these carry Date columns and Decimal
      // amounts, and the client types declare ISO strings and strings.
      workflow={serialize(workflow) as WorkflowState | null}
      history={serialize(history) as HistoryEntry[]}
      shortfalls={serialize(shortfalls) as Shortfall[] | null}
      canClaimTask={can(user, CAPABILITIES.WORKFLOW_CLAIM_TASK)}
      currentUserId={user.id}
      audit={serialize(auditRows) as AuditRow[] | null}
      openShortfalls={serialize(openShortfalls) as unknown as ShortfallRow[]}
      viewerIsApplicant={isLtp(user)}
      order={serialize(order) as unknown as OrderView | null}
      canAdvanceOrder={can(user, CAPABILITIES.APPLICATION_APPROVE)}
      inspections={serialize(inspections) as unknown as ApplicationInspectionsPayload | null}
      nocs={serialize(nocs) as unknown as ApplicationNocsPayload | null}
      proceedings={serialize(proceedings) as unknown as ApplicationProceedingsPayload | null}
      professional={serialize(professional) as unknown as ApplicationProfessionalPayload | null}
      commencement={serialize(commencement) as unknown as ApplicationCommencementPayload | null}
      occupancy={serialize(occupancy) as unknown as ApplicationOccupancyPayload | null}
    />
  );
}
