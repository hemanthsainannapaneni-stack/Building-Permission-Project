/**
 * What the workflow endpoints return, as the client sees it.
 *
 * Dates arrive as ISO strings and money as strings — the server serialises
 * both — so these are deliberately NOT the server's types with `Date` in them.
 * A shared type that lies about the wire format is worse than two honest ones.
 */

export type ActionOption = {
  code: string;
  label: string;
  kind: string;
  intent: string;
  requiresRemarks: boolean;
  requiresAttachment: boolean;
  confirmText: string;
  toStageCode: string;
  toStageName: string;
  toStatus: string;
  available: boolean;
  reason: string;
  guards: Array<{ name: string; passed: boolean; message: string }>;
  shortfall: { kind: string; mode: string } | null;
  /**
   * Present for the site inspection actions. Booking needs an inspector and a
   * date, submitting needs 27 answers, photographs and a signature — so these
   * are a pointer to the Site Inspection tab, never the generic modal.
   */
  inspection?: { step: string } | null;
  /** Show cause / revocation actions: a pointer to the Proceedings tab, never the generic modal. */
  proceeding?: { module: string; step: string } | null;
};

/** The service-standard clock on the open task, as the client sees it. */
export type SlaClockView = {
  startedAt: string;
  targetDays: number | null;
  calendar: string;
  dueAt: string;
  elapsedDays: number;
  remainingDays: number;
  status: string;
  percent: number;
  isPaused: boolean;
  isDueSoon: boolean;
  isOverdue: boolean;
  overdueDays: number;
  escalatesTo: string | null;
};

export type WorkflowState = {
  application: { id: string; applicationNumber: string; status: string };
  instance: {
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    parkedStageCode: string | null;
  } | null;
  stage: { code: string; name: string; type: string; sequence: number; isTerminal: boolean } | null;
  task: {
    id: string;
    status: string;
    assignedRoleKey: string;
    assignedUserId: string | null;
    assignedUserName: string;
    receivedAt: string;
    claimedAt: string | null;
    priority: number;
    dueAt: string | null;
    slaStatus: string | null;
    sla: SlaClockView | null;
    mine: boolean;
  } | null;
  actions: ActionOption[];
  sequence: number;
};

export type HistoryEntry = {
  id: string;
  sequence: number;
  fromStageCode: string;
  toStageCode: string;
  fromStatus: string;
  toStatus: string;
  actionCode: string;
  actionLabel: string;
  actorName: string;
  actorRoleKey: string;
  remarks: string;
  effectsApplied: Array<Record<string, unknown>>;
  occurredAt: string;
};

export type ShortfallItem = {
  id: string;
  description: string;
  amount: string | null;
  isResolved: boolean;
};

export type ShortfallResolution = {
  id: string;
  attemptNo: number;
  response: string;
  respondedAt: string;
  accepted: boolean | null;
  reviewedAt: string | null;
  reviewRemarks: string;
};

export type Shortfall = {
  id: string;
  shortfallNumber: string;
  kind: string;
  mode: string;
  status: string;
  title: string;
  description: string;
  raisedAtStageCode: string;
  raisedByRoleKey: string;
  raisedAt: string;
  dueDate: string | null;
  closedAt: string | null;
  closureRemarks: string;
  items: ShortfallItem[];
  resolutions: ShortfallResolution[];
};

export type TaskRowView = {
  id: string;
  applicationId: string;
  applicationNumber: string;
  applicationType: string;
  applicantName: string;
  property: string;
  zone: string;
  stageCode: string;
  stageName: string;
  status: string;
  receivedAt: string;
  daysPending: number;
  dueAt: string | null;
  slaStatus: string | null;
  priority: number;
  openShortfalls: number;
  claimedById: string | null;
  claimedByName: string;
  mine: boolean;
  unclaimed: boolean;
};

export type TaskListPayload = {
  rows: TaskRowView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: Record<string, number>;
};

export type ActionResult = {
  applicationId: string;
  applicationNumber: string;
  actionCode: string;
  fromStageCode: string;
  toStageCode: string;
  fromStatus: string;
  toStatus: string;
  sequence: number;
  message: string;
  taskId: string | null;
  shortfallNumbers: string[];
};
