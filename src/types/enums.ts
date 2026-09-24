// LAMS Enum Definitions
// Used when the underlying database is SQLite (which does not support native enums).
// Provides exact runtime values and TypeScript types matching Prisma enums.

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  LOCKED: 'LOCKED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const ApplicationStatus = {
  // LTP side
  DRAFT: 'DRAFT',
  DRAWING_UPLOADED: 'DRAWING_UPLOADED',
  SCRUTINY_IN_PROGRESS: 'SCRUTINY_IN_PROGRESS',
  SCRUTINY_FAILED: 'SCRUTINY_FAILED',
  SCRUTINY_PASSED: 'SCRUTINY_PASSED',
  DOCUMENT_UPLOAD_PENDING: 'DOCUMENT_UPLOAD_PENDING',
  DOCUMENTS_COMPLETED: 'DOCUMENTS_COMPLETED',
  FEE_GENERATED: 'FEE_GENERATED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_SUCCESSFUL: 'PAYMENT_SUCCESSFUL',
  SUBMITTED: 'SUBMITTED',

  // Department side
  PENDING_TPA: 'PENDING_TPA',
  TPA_REVIEW: 'TPA_REVIEW',
  TPA_DOCUMENT_SHORTFALL: 'TPA_DOCUMENT_SHORTFALL',
  TPA_FEE_SHORTFALL: 'TPA_FEE_SHORTFALL',
  TPA_TECHNICAL_SHORTFALL: 'TPA_TECHNICAL_SHORTFALL',
  SITE_INSPECTION_SCHEDULED: 'SITE_INSPECTION_SCHEDULED',
  SITE_INSPECTION_IN_PROGRESS: 'SITE_INSPECTION_IN_PROGRESS',
  PENDING_ZAD_ZDD: 'PENDING_ZAD_ZDD',
  ZAD_ZDD_REVIEW: 'ZAD_ZDD_REVIEW',
  ZAD_ZDD_SHORTFALL: 'ZAD_ZDD_SHORTFALL',
  PENDING_ZJD: 'PENDING_ZJD',
  ZJD_REVIEW: 'ZJD_REVIEW',
  ZJD_SHORTFALL: 'ZJD_SHORTFALL',
  ZJD_FEE_SHORTFALL: 'ZJD_FEE_SHORTFALL',
  PENDING_DIRECTOR_DP: 'PENDING_DIRECTOR_DP',
  DIRECTOR_REVIEW: 'DIRECTOR_REVIEW',
  DIRECTOR_SHORTFALL: 'DIRECTOR_SHORTFALL',
  DIRECTOR_REPORTED_SHORTFALL: 'DIRECTOR_REPORTED_SHORTFALL',
  PENDING_ADDITIONAL_COMMISSIONER: 'PENDING_ADDITIONAL_COMMISSIONER',
  ADDITIONAL_COMMISSIONER_REVIEW: 'ADDITIONAL_COMMISSIONER_REVIEW',
  ADDITIONAL_COMMISSIONER_SHORTFALL: 'ADDITIONAL_COMMISSIONER_SHORTFALL',
  PENDING_COMMISSIONER: 'PENDING_COMMISSIONER',
  COMMISSIONER_REVIEW: 'COMMISSIONER_REVIEW',
  COMMISSIONER_SHORTFALL: 'COMMISSIONER_SHORTFALL',

  // Parked
  RETURNED_TO_APPLICANT: 'RETURNED_TO_APPLICANT',
  SHORTFALL_RESPONDED: 'SHORTFALL_RESPONDED',

  // Terminal
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  LAPSED: 'LAPSED',
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const StageType = {
  LTP_ACTION: 'LTP_ACTION',
  REVIEW: 'REVIEW',
  APPROVAL: 'APPROVAL',
  TERMINAL: 'TERMINAL',
} as const;
export type StageType = (typeof StageType)[keyof typeof StageType];

export const ActionKind = {
  FORWARD: 'FORWARD',
  RETURN: 'RETURN',
  REPORT_AND_FORWARD: 'REPORT_AND_FORWARD',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  RESUBMIT: 'RESUBMIT',
  CLARIFY: 'CLARIFY',
  SYSTEM: 'SYSTEM',
} as const;
export type ActionKind = (typeof ActionKind)[keyof typeof ActionKind];

export const WorkflowInstanceStatus = {
  ACTIVE: 'ACTIVE',
  PARKED: 'PARKED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type WorkflowInstanceStatus = (typeof WorkflowInstanceStatus)[keyof typeof WorkflowInstanceStatus];

export const TaskStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REASSIGNED: 'REASSIGNED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const AssignmentStrategy = {
  ROLE_QUEUE: 'ROLE_QUEUE',
  DIRECT: 'DIRECT',
  LEAST_LOADED: 'LEAST_LOADED',
  ROUND_ROBIN: 'ROUND_ROBIN',
} as const;
export type AssignmentStrategy = (typeof AssignmentStrategy)[keyof typeof AssignmentStrategy];

export const ScrutinyStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  ERRORED: 'ERRORED',
  CANCELLED: 'CANCELLED',
} as const;
export type ScrutinyStatus = (typeof ScrutinyStatus)[keyof typeof ScrutinyStatus];

export const ScrutinyOutcome = {
  PASS: 'PASS',
  FAIL: 'FAIL',
} as const;
export type ScrutinyOutcome = (typeof ScrutinyOutcome)[keyof typeof ScrutinyOutcome];

export const IssueSeverity = {
  CRITICAL: 'CRITICAL',
  MAJOR: 'MAJOR',
  MINOR: 'MINOR',
  INFO: 'INFO',
} as const;
export type IssueSeverity = (typeof IssueSeverity)[keyof typeof IssueSeverity];

export const DocumentStatus = {
  NOT_UPLOADED: 'NOT_UPLOADED',
  UPLOADED: 'UPLOADED',
  UNDER_VERIFICATION: 'UNDER_VERIFICATION',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  SUPERSEDED: 'SUPERSEDED',
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const ScanStatus = {
  PENDING: 'PENDING',
  CLEAN: 'CLEAN',
  INFECTED: 'INFECTED',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
} as const;
export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

export const FeeDemandType = {
  ORIGINAL: 'ORIGINAL',
  SHORTFALL: 'SHORTFALL',
  REVISION: 'REVISION',
} as const;
export type FeeDemandType = (typeof FeeDemandType)[keyof typeof FeeDemandType];

export const FeeDemandStatus = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  WAIVED: 'WAIVED',
} as const;
export type FeeDemandStatus = (typeof FeeDemandStatus)[keyof typeof FeeDemandStatus];

export const CalculationBasis = {
  FLAT: 'FLAT',
  PER_UNIT_AREA: 'PER_UNIT_AREA',
  SLAB: 'SLAB',
  PERCENTAGE: 'PERCENTAGE',
  FORMULA: 'FORMULA',
} as const;
export type CalculationBasis = (typeof CalculationBasis)[keyof typeof CalculationBasis];

export const FeeAdjustmentKind = {
  REBATE: 'REBATE',
  SURCHARGE: 'SURCHARGE',
} as const;
export type FeeAdjustmentKind = (typeof FeeAdjustmentKind)[keyof typeof FeeAdjustmentKind];

export const PaymentStatus = {
  INITIATED: 'INITIATED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMEOUT: 'TIMEOUT',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const RefundStatus = {
  REQUESTED: 'REQUESTED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const ShortfallKind = {
  DOCUMENT: 'DOCUMENT',
  FEE: 'FEE',
  TECHNICAL: 'TECHNICAL',
  CLARIFICATION: 'CLARIFICATION',
  OTHER: 'OTHER',
} as const;
export type ShortfallKind = (typeof ShortfallKind)[keyof typeof ShortfallKind];

export const ShortfallStatus = {
  RAISED: 'RAISED',
  NOTIFIED: 'NOTIFIED',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  RESOLUTION_SUBMITTED: 'RESOLUTION_SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  RESOLUTION_REJECTED: 'RESOLUTION_REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ShortfallStatus = (typeof ShortfallStatus)[keyof typeof ShortfallStatus];

export const ShortfallMode = {
  BLOCKING: 'BLOCKING',
  REPORTED: 'REPORTED',
} as const;
export type ShortfallMode = (typeof ShortfallMode)[keyof typeof ShortfallMode];

export const SlaStatus = {
  ON_TRACK: 'ON_TRACK',
  DUE_SOON: 'DUE_SOON',
  OVERDUE: 'OVERDUE',
  COMPLETED: 'COMPLETED',
  PAUSED: 'PAUSED',
} as const;
export type SlaStatus = (typeof SlaStatus)[keyof typeof SlaStatus];

export const SlaCalendar = {
  CALENDAR_DAYS: 'CALENDAR_DAYS',
  WORKING_DAYS: 'WORKING_DAYS',
} as const;
export type SlaCalendar = (typeof SlaCalendar)[keyof typeof SlaCalendar];

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const DeliveryStatus = {
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const OrderStatus = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  REVOKED: 'REVOKED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const JobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const SettingType = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  JSON: 'JSON',
} as const;
export type SettingType = (typeof SettingType)[keyof typeof SettingType];

export const ApplicationPurpose = {
  NEW: 'NEW',
  REVISION: 'REVISION',
  RENEWAL: 'RENEWAL',
  REVALIDATION: 'REVALIDATION',
} as const;
export type ApplicationPurpose = (typeof ApplicationPurpose)[keyof typeof ApplicationPurpose];
