import type { PrismaClient } from '@prisma/client';

/**
 * Notification templates — docs/07-subsystems.md M.2 and M.3, as data.
 *
 * ── Written for the person receiving them ────────────────────────────────
 *
 * An SMS is 160 characters and arrives on a phone with no context. It has to
 * say which application, what is wanted, and by when — in that order, because
 * that is the order the reader needs them. An email can afford the courtesy of
 * a sentence. An in-app message sits next to the thing it is about, so it is
 * the shortest of the three.
 *
 * ── Every SMS needs a DLT template id ────────────────────────────────────
 *
 * `providerTemplateId` is EMPTY here and the SMS adapter refuses to send
 * without one. That is not an oversight: DLT ids are issued by the operator
 * against a registered account, nobody has told us whose account that is
 * (Q13), and inventing them would produce messages the carrier silently drops.
 * With the mock provider the id is not required, so the demo works; the moment
 * a real gateway is configured, every unregistered template shows up as a
 * SKIPPED row naming itself. A gap you can see beats a message you cannot.
 */

type TemplateSeed = {
  eventCode: string;
  channel: 'IN_APP' | 'EMAIL' | 'SMS';
  subject: string;
  body: string;
  variables: string[];
};

const A = 'applicationNumber';

const TEMPLATES: TemplateSeed[] = [
  // ── The applicant's own progress ───────────────────────────────────────
  {
    eventCode: 'APPLICATION_CREATED',
    channel: 'IN_APP',
    subject: 'Application {{applicationNumber}} created',
    body: 'Your application has been created. Complete the remaining steps to file it.',
    variables: [A],
  },
  {
    eventCode: 'APPLICATION_SUBMITTED',
    channel: 'IN_APP',
    subject: 'Application {{applicationNumber}} filed',
    body:
      'Your application has been filed and is with the department. ' +
      'You will be told when it is reviewed or if anything further is required.',
    variables: [A],
  },
  {
    eventCode: 'APPLICATION_SUBMITTED',
    channel: 'EMAIL',
    subject: 'Application {{applicationNumber}} has been filed',
    body:
      'Dear {{recipientName}},\n\n' +
      'Application {{applicationNumber}} has been filed and is now with the department.\n\n' +
      'You can follow its progress here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'APPLICATION_SUBMITTED',
    channel: 'SMS',
    subject: '',
    body: 'Application {{applicationNumber}} has been filed and is with the department. - {{orgShortName}}',
    variables: [A, 'orgShortName'],
  },
  {
    eventCode: 'DRAWING_UPLOADED',
    channel: 'IN_APP',
    subject: 'Drawing uploaded',
    body: 'The drawing for {{applicationNumber}} has been uploaded and sent for scrutiny.',
    variables: [A],
  },
  {
    eventCode: 'SCRUTINY_PASSED',
    channel: 'IN_APP',
    subject: 'Scrutiny passed',
    body: 'The drawing for {{applicationNumber}} passed scrutiny. Upload the required documents next.',
    variables: [A],
  },
  {
    eventCode: 'SCRUTINY_PASSED',
    channel: 'EMAIL',
    subject: 'Scrutiny passed — {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'The drawing submitted with application {{applicationNumber}} has passed automated scrutiny.\n\n' +
      'The next step is the document checklist: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'SCRUTINY_FAILED',
    channel: 'IN_APP',
    subject: 'Scrutiny failed',
    body: 'The drawing for {{applicationNumber}} did not pass scrutiny. Correct it and upload a new version.',
    variables: [A],
  },
  {
    eventCode: 'SCRUTINY_FAILED',
    channel: 'EMAIL',
    subject: 'Scrutiny did not pass — {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'The drawing submitted with application {{applicationNumber}} did not pass scrutiny.\n\n' +
      'The findings are listed on the scrutiny report. A correction is uploaded as a new version — the ' +
      'previous one is kept: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'SCRUTINY_FAILED',
    channel: 'SMS',
    subject: '',
    body:
      'Application {{applicationNumber}}: the drawing did not pass scrutiny. ' +
      'Please correct it and upload a new version. - {{orgShortName}}',
    variables: [A, 'orgShortName'],
  },
  {
    eventCode: 'DOCUMENTS_COMPLETED',
    channel: 'IN_APP',
    subject: 'Documents complete',
    body: 'Every required document for {{applicationNumber}} is in. A fee demand can now be raised.',
    variables: [A],
  },

  // ── Money ──────────────────────────────────────────────────────────────
  {
    eventCode: 'FEE_GENERATED',
    channel: 'IN_APP',
    subject: 'Fee demand {{demandNumber}} raised',
    body: 'A fee of {{total}} is payable on {{applicationNumber}}.',
    variables: [A, 'demandNumber', 'total'],
  },
  {
    eventCode: 'FEE_GENERATED',
    channel: 'EMAIL',
    subject: 'Fee demand {{demandNumber}} for application {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'A fee of Rs. {{total}} has been raised against application {{applicationNumber}} under demand ' +
      '{{demandNumber}}.\n\n' +
      'The itemised breakdown and the payment link are here: {{link}}\n\n' +
      'The application goes to the department once the fee has been paid in full.\n\n' +
      '{{orgName}}',
    variables: [A, 'demandNumber', 'total', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'FEE_GENERATED',
    channel: 'SMS',
    subject: '',
    body:
      'Application {{applicationNumber}}: fee of Rs.{{total}} is payable under demand {{demandNumber}}. ' +
      'Pay online to send the file to the department. - {{orgShortName}}',
    variables: [A, 'demandNumber', 'total', 'orgShortName'],
  },
  {
    eventCode: 'PAYMENT_SUCCESSFUL',
    channel: 'IN_APP',
    subject: 'Payment received',
    body: 'Payment of {{amount}} received for {{applicationNumber}}. Receipt {{receiptNumber}}.',
    variables: [A, 'amount', 'receiptNumber'],
  },
  {
    eventCode: 'PAYMENT_SUCCESSFUL',
    channel: 'EMAIL',
    subject: 'Payment received — {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'We have received Rs. {{amount}} against application {{applicationNumber}}.\n' +
      'Your receipt number is {{receiptNumber}}.\n\n' +
      'The receipt can be downloaded here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'amount', 'receiptNumber', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'PAYMENT_SUCCESSFUL',
    channel: 'SMS',
    subject: '',
    body:
      'Rs.{{amount}} received for application {{applicationNumber}}. Receipt {{receiptNumber}}. ' +
      '- {{orgShortName}}',
    variables: [A, 'amount', 'receiptNumber', 'orgShortName'],
  },
  {
    eventCode: 'PAYMENT_FAILED',
    channel: 'IN_APP',
    subject: 'Payment did not go through',
    body: 'The payment for {{applicationNumber}} was not completed. You can try again.',
    variables: [A],
  },
  {
    eventCode: 'PAYMENT_FAILED',
    channel: 'EMAIL',
    subject: 'Payment not completed — {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'The payment attempt against application {{applicationNumber}} was not completed, and nothing ' +
      'has been charged.\n\n' +
      'You can try again here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'link', 'orgName'],
  },

  // ── Movement ───────────────────────────────────────────────────────────
  {
    eventCode: 'APPLICATION_FORWARDED',
    channel: 'IN_APP',
    subject: 'Application moved on',
    body: '{{applicationNumber}} has been sent to the next desk. Nothing is needed from you.',
    variables: [A],
  },
  {
    eventCode: 'APPLICATION_RETURNED',
    channel: 'IN_APP',
    subject: 'Application returned',
    body: '{{applicationNumber}} has been sent back a stage. {{remarks}}',
    variables: [A, 'remarks'],
  },
  {
    eventCode: 'APPLICATION_RETURNED',
    channel: 'EMAIL',
    subject: 'Application {{applicationNumber}} has been returned',
    body:
      'Dear {{recipientName}},\n\n' +
      'Application {{applicationNumber}} has been returned to an earlier stage of review.\n\n' +
      'Reason given: {{remarks}}\n\n' +
      '{{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'remarks', 'link', 'orgName'],
  },
  {
    eventCode: 'TASK_ASSIGNED',
    channel: 'IN_APP',
    subject: 'A file has arrived at your desk',
    body: '{{applicationNumber}} is now at {{stageName}} and is waiting to be worked.',
    variables: [A, 'stageName'],
  },
  {
    eventCode: 'TASK_ASSIGNED',
    channel: 'EMAIL',
    subject: '{{applicationNumber}} is waiting at {{stageName}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Application {{applicationNumber}} has arrived at {{stageName}}.\n\n' +
      'Open it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'stageName', 'recipientName', 'link', 'orgName'],
  },

  // ── Shortfalls — the ones this phase exists for ────────────────────────
  //
  // All three channels on every one of them, because a shortfall is the point
  // at which an application stops moving and stays stopped until somebody
  // acts. An applicant who does not hear about it has no way of knowing.
  {
    eventCode: 'SHORTFALL_RAISED',
    channel: 'IN_APP',
    subject: '{{title}} — {{shortfallNumber}}',
    body: '{{shortfallReason}} {{requiredAction}}',
    variables: ['title', 'shortfallNumber', 'shortfallReason', 'requiredAction'],
  },
  {
    eventCode: 'SHORTFALL_RAISED',
    channel: 'EMAIL',
    subject: 'Action required on application {{applicationNumber}} — {{shortfallNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'The department has raised a shortfall against application {{applicationNumber}}.\n\n' +
      '{{title}}\n' +
      '{{shortfallReason}}\n\n' +
      'What is required: {{requiredAction}}\n' +
      'Raised by: {{officerName}}\n\n' +
      'Respond here: {{link}}\n\n' +
      'The application cannot be approved until this has been settled.\n\n' +
      '{{orgName}}',
    variables: [
      A,
      'recipientName',
      'title',
      'shortfallNumber',
      'shortfallReason',
      'requiredAction',
      'officerName',
      'link',
      'orgName',
    ],
  },
  {
    eventCode: 'SHORTFALL_RAISED',
    channel: 'SMS',
    subject: '',
    body:
      'Application {{applicationNumber}}: {{title}}. {{requiredAction}} ' +
      'Ref {{shortfallNumber}}. - {{orgShortName}}',
    variables: [A, 'title', 'requiredAction', 'shortfallNumber', 'orgShortName'],
  },
  {
    eventCode: 'SHORTFALL_RESPONDED',
    channel: 'IN_APP',
    subject: 'A shortfall response is waiting for you',
    body: '{{applicationNumber}}: the applicant has answered {{shortfallNumber}}. Attempt {{attemptNo}}.',
    variables: [A, 'shortfallNumber', 'attemptNo'],
  },
  {
    eventCode: 'SHORTFALL_RESPONDED',
    channel: 'EMAIL',
    subject: 'Response to {{shortfallNumber}} on application {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'The applicant has responded to shortfall {{shortfallNumber}} on application ' +
      '{{applicationNumber}} (attempt {{attemptNo}}).\n\n' +
      'Their response: {{remarks}}\n\n' +
      'Accept or reject it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'shortfallNumber', 'attemptNo', 'remarks', 'link', 'orgName'],
  },
  {
    eventCode: 'SHORTFALL_RESOLVED',
    channel: 'IN_APP',
    subject: 'Shortfall {{shortfallNumber}} settled',
    body: 'The department has accepted your response on {{applicationNumber}}. {{remarks}}',
    variables: [A, 'shortfallNumber', 'remarks'],
  },
  {
    eventCode: 'SHORTFALL_RESOLVED',
    channel: 'EMAIL',
    subject: 'Shortfall {{shortfallNumber}} has been settled — {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Shortfall {{shortfallNumber}} on application {{applicationNumber}} has been settled.\n\n' +
      'Officer’s remarks: {{remarks}}\n\n' +
      'The application has resumed its review: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'shortfallNumber', 'remarks', 'link', 'orgName'],
  },
  {
    eventCode: 'SHORTFALL_RESOLVED',
    channel: 'SMS',
    subject: '',
    body:
      'Application {{applicationNumber}}: shortfall {{shortfallNumber}} has been settled and the ' +
      'review has resumed. - {{orgShortName}}',
    variables: [A, 'shortfallNumber', 'orgShortName'],
  },
  {
    eventCode: 'SHORTFALL_REJECTED',
    channel: 'IN_APP',
    subject: 'Your response was not accepted',
    body: '{{shortfallNumber}} on {{applicationNumber}} is still outstanding. {{remarks}}',
    variables: [A, 'shortfallNumber', 'remarks'],
  },
  {
    eventCode: 'SHORTFALL_REJECTED',
    channel: 'EMAIL',
    subject: 'Response not accepted — {{shortfallNumber}} on {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Your response to shortfall {{shortfallNumber}} on application {{applicationNumber}} has not ' +
      'been accepted.\n\n' +
      'Officer’s remarks: {{remarks}}\n\n' +
      'You can respond again here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'shortfallNumber', 'remarks', 'link', 'orgName'],
  },
  {
    eventCode: 'SHORTFALL_REJECTED',
    channel: 'SMS',
    subject: '',
    body:
      'Application {{applicationNumber}}: your response to {{shortfallNumber}} was not accepted. ' +
      'Please check the details and respond again. - {{orgShortName}}',
    variables: [A, 'shortfallNumber', 'orgShortName'],
  },

  // ── The decision ───────────────────────────────────────────────────────
  {
    eventCode: 'APPLICATION_APPROVED',
    channel: 'IN_APP',
    subject: 'Application approved',
    body: '{{applicationNumber}} has been approved. The approval order is being prepared.',
    variables: [A],
  },
  {
    eventCode: 'APPLICATION_APPROVED',
    channel: 'EMAIL',
    subject: 'Application {{applicationNumber}} has been approved',
    body:
      'Dear {{recipientName}},\n\n' +
      'Building permission has been granted on application {{applicationNumber}}.\n\n' +
      'The approval order will be available here shortly: {{link}}\n\n' +
      'Construction must follow the sanctioned plan and any conditions printed on the order.\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'APPLICATION_APPROVED',
    channel: 'SMS',
    subject: '',
    body:
      'Application {{applicationNumber}} has been APPROVED. The approval order will be available ' +
      'online shortly. - {{orgShortName}}',
    variables: [A, 'orgShortName'],
  },
  {
    eventCode: 'APPLICATION_REJECTED',
    channel: 'IN_APP',
    subject: 'Application rejected',
    body: '{{applicationNumber}} has been rejected. {{remarks}}',
    variables: [A, 'remarks'],
  },
  {
    eventCode: 'APPLICATION_REJECTED',
    channel: 'EMAIL',
    subject: 'Application {{applicationNumber}} has been rejected',
    body:
      'Dear {{recipientName}},\n\n' +
      'Application {{applicationNumber}} has been rejected.\n\n' +
      'Reason given: {{remarks}}\n\n' +
      'The full record is here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'remarks', 'link', 'orgName'],
  },
  {
    eventCode: 'APPLICATION_REJECTED',
    channel: 'SMS',
    subject: '',
    body:
      'Application {{applicationNumber}} has been rejected. Please see the portal for the reasons. ' +
      '- {{orgShortName}}',
    variables: [A, 'orgShortName'],
  },
  {
    eventCode: 'ORDER_ISSUED',
    channel: 'IN_APP',
    subject: 'Approval order {{orderNumber}} issued',
    body: 'The approval order for {{applicationNumber}} is ready to download.',
    variables: [A, 'orderNumber'],
  },
  {
    eventCode: 'ORDER_ISSUED',
    channel: 'EMAIL',
    subject: 'Approval order {{orderNumber}} — {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Approval order {{orderNumber}} has been issued for application {{applicationNumber}}.\n\n' +
      'Download it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'orderNumber', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'ORDER_ISSUED',
    channel: 'SMS',
    subject: '',
    body:
      'Approval order {{orderNumber}} for application {{applicationNumber}} has been issued and is ' +
      'available online. - {{orgShortName}}',
    variables: [A, 'orderNumber', 'orgShortName'],
  },

  // ── The service standard ───────────────────────────────────────────────
  //
  // To the officer, never to the applicant: passing an SLA has no legal effect
  // in this system (docs R.1.1), and telling a citizen their file is "overdue"
  // would imply a remedy that does not exist.
  {
    eventCode: 'SLA_DUE_SOON',
    channel: 'IN_APP',
    subject: 'A file at your desk is due soon',
    body: '{{applicationNumber}} at {{stageName}} is due on {{dueAt}}.',
    variables: [A, 'stageName', 'dueAt'],
  },
  {
    eventCode: 'SLA_OVERDUE',
    channel: 'IN_APP',
    subject: 'A file at your desk is overdue',
    body: '{{applicationNumber}} at {{stageName}} is {{overdueDays}} day(s) past its service standard.',
    variables: [A, 'stageName', 'overdueDays'],
  },
  {
    eventCode: 'SLA_OVERDUE',
    channel: 'EMAIL',
    subject: '{{applicationNumber}} is past its service standard',
    body:
      'Dear {{recipientName}},\n\n' +
      'Application {{applicationNumber}} has been at {{stageName}} beyond its service standard — ' +
      '{{overdueDays}} day(s) over.\n\n' +
      '{{link}}\n\n' +
      'This is a reporting notice. It does not change what may be done with the application.\n\n' +
      '{{orgName}}',
    variables: [A, 'stageName', 'overdueDays', 'recipientName', 'link', 'orgName'],
  },

  // ── Gaps found by the template-coverage check ─────────────────────────
  //
  // These three had neither a template row nor a built-in fallback, so the
  // dispatcher rendered nothing and the message was silently dropped. Two of
  // them are marked MANDATORY in the recipient rules — an account created
  // today received no welcome at all, and a password reset produced no email,
  // which is the difference between a working reset flow and a broken one.
  {
    eventCode: 'DOCUMENTS_PENDING',
    channel: 'IN_APP',
    subject: 'Documents outstanding on {{applicationNumber}}',
    body: 'Some required documents have not been uploaded yet. The fee cannot be raised until they are in.',
    variables: [A],
  },
  {
    eventCode: 'DOCUMENTS_PENDING',
    channel: 'EMAIL',
    subject: 'Documents outstanding — {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Some of the documents required for application {{applicationNumber}} have not been uploaded yet.\n\n' +
      'Upload them here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'USER_CREATED',
    channel: 'EMAIL',
    subject: 'Your {{orgName}} account has been created',
    body:
      'Dear {{recipientName}},\n\n' +
      'An account has been created for you on {{orgName}} with the email address {{email}}.\n\n' +
      'Set your password using the link you have been sent separately, then sign in here: {{link}}\n\n' +
      'If you were not expecting this, tell your administrator.\n\n' +
      '{{orgName}}',
    // No password, and no link that sets one. A credential in an email body is
    // a credential in a mailbox, a backup and a log, for ever.
    variables: ['recipientName', 'email', 'link', 'orgName'],
  },
  {
    eventCode: 'USER_CREATED',
    channel: 'IN_APP',
    subject: 'Welcome to {{orgName}}',
    body: 'Your account is active. Your role decides what you can see and do.',
    variables: ['orgName'],
  },
  {
    eventCode: 'PASSWORD_RESET',
    channel: 'EMAIL',
    subject: 'Reset your {{orgName}} password',
    body:
      'Dear {{recipientName}},\n\n' +
      'A password reset was requested for your account.\n\n' +
      'Use this link to set a new password: {{link}}\n\n' +
      'The link expires shortly. If you did not ask for this, ignore this message — ' +
      'your password has not been changed.\n\n' +
      '{{orgName}}',
    variables: ['recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'PASSWORD_RESET',
    channel: 'SMS',
    subject: '',
    body: 'A password reset was requested for your {{orgShortName}} account. If this was not you, ignore this message.',
    variables: ['orgShortName'],
  },

  // ── Phase 3: the desk-facing events ───────────────────────────────────
  //
  // These tell an OFFICER that work has arrived, so they are in-app and email
  // only. An SMS to a departmental account at 2am about a file that will still
  // be there in the morning is the message that teaches people to mute the
  // channel the shortfall notices also arrive on.
  {
    eventCode: 'APPLICATION_ASSIGNED',
    channel: 'IN_APP',
    subject: 'Application {{applicationNumber}} assigned to you',
    body: '{{applicationNumber}} is now with you at {{stageName}}. {{dueLine}}',
    variables: [A, 'stageName', 'dueLine'],
  },
  {
    eventCode: 'APPLICATION_ASSIGNED',
    channel: 'EMAIL',
    subject: 'Assigned to you: {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Application {{applicationNumber}} has been assigned to you at {{stageName}}.\n\n' +
      '{{dueLine}}\n\n' +
      'Open it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'stageName', 'dueLine', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'REVIEW_REQUIRED',
    channel: 'IN_APP',
    subject: 'Review required — {{applicationNumber}}',
    body: '{{applicationNumber}} has arrived at {{stageName}} and is waiting to be reviewed. {{dueLine}}',
    variables: [A, 'stageName', 'dueLine'],
  },
  {
    eventCode: 'REVIEW_REQUIRED',
    channel: 'EMAIL',
    subject: 'Review required: {{applicationNumber}} at {{stageName}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Application {{applicationNumber}} is waiting for review at {{stageName}}.\n\n' +
      '{{dueLine}}\n\n' +
      'Open it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'stageName', 'dueLine', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'APPROVAL_REQUIRED',
    channel: 'IN_APP',
    subject: 'Approval required — {{applicationNumber}}',
    body:
      '{{applicationNumber}} has reached {{stageName}} and is ready for a decision. ' +
      'Every shortfall on it must be settled before it can be approved. {{dueLine}}',
    variables: [A, 'stageName', 'dueLine'],
  },
  {
    eventCode: 'APPROVAL_REQUIRED',
    channel: 'EMAIL',
    subject: 'Approval required: {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Application {{applicationNumber}} has reached {{stageName}} and is ready for a decision.\n\n' +
      '{{dueLine}}\n\n' +
      'Open it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'stageName', 'dueLine', 'recipientName', 'link', 'orgName'],
  },

  // ── Declared for later phases ─────────────────────────────────────────
  //
  // Nothing emits these yet. They are seeded so that Site Inspection,
  // Commencement and Occupancy each find a template waiting rather than
  // writing a fourth variation of the same sentence — and so an administrator
  // can read today what those modules will eventually say.
  {
    eventCode: 'INSPECTION_DUE',
    channel: 'IN_APP',
    subject: 'Site inspection due — {{applicationNumber}}',
    body: 'The site inspection for {{applicationNumber}} is due on {{dueDate}}.',
    variables: [A, 'dueDate'],
  },
  {
    eventCode: 'INSPECTION_DUE',
    channel: 'EMAIL',
    subject: 'Site inspection due on {{dueDate}} — {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'The site inspection for application {{applicationNumber}} is due on {{dueDate}}.\n\n' +
      'Details: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'dueDate', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'INSPECTION_DUE',
    channel: 'SMS',
    subject: '',
    body: 'Site inspection for application {{applicationNumber}} is due on {{dueDate}}. - {{orgShortName}}',
    variables: [A, 'dueDate', 'orgShortName'],
  },
  {
    eventCode: 'WORK_INITIATED',
    channel: 'IN_APP',
    subject: 'Work initiated — {{applicationNumber}}',
    body: 'Commencement of work has been recorded against {{applicationNumber}}.',
    variables: [A],
  },
  {
    eventCode: 'WORK_INITIATED',
    channel: 'EMAIL',
    subject: 'Commencement recorded — {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Commencement of work has been recorded against application {{applicationNumber}}.\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'orgName'],
  },
  {
    eventCode: 'OCCUPANCY_SUBMITTED',
    channel: 'IN_APP',
    subject: 'Occupancy application filed — {{applicationNumber}}',
    body: 'An occupancy certificate application has been filed against {{applicationNumber}}.',
    variables: [A],
  },
  {
    eventCode: 'OCCUPANCY_SUBMITTED',
    channel: 'EMAIL',
    subject: 'Occupancy application filed — {{applicationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'An occupancy certificate application has been filed against {{applicationNumber}}.\n\n' +
      'Open it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: [A, 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'OCCUPANCY_SUBMITTED',
    channel: 'SMS',
    subject: '',
    body: 'Occupancy application filed against {{applicationNumber}}. - {{orgShortName}}',
    variables: [A, 'orgShortName'],
  },
  // ── Developer registration (Phase 11) — no applicationId, its own register.
  // PROVISIONAL WORDING: no manual supplied to this project names this
  // correspondence; replace freely.
  {
    eventCode: 'DEVELOPER_REGISTRATION_SUBMITTED',
    channel: 'IN_APP',
    subject: 'Developer registration submitted — {{registrationNumber}}',
    body: '{{developerName}} — registration {{registrationNumber}} has been submitted and is ready to take up.',
    variables: ['registrationNumber', 'developerName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_SUBMITTED',
    channel: 'EMAIL',
    subject: 'Developer registration submitted — {{registrationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'The developer registration {{registrationNumber}} for {{developerName}} has been submitted.\n\n' +
      'Open it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: ['registrationNumber', 'developerName', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_SUBMITTED',
    channel: 'SMS',
    subject: '',
    body: 'Developer registration {{registrationNumber}} submitted for review. - {{orgShortName}}',
    variables: ['registrationNumber', 'orgShortName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_SHORTFALL_RAISED',
    channel: 'IN_APP',
    subject: 'Shortfall raised — {{registrationNumber}}',
    body: 'A shortfall has been raised on {{registrationNumber}}: {{items}}',
    variables: ['registrationNumber', 'items'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_SHORTFALL_RAISED',
    channel: 'EMAIL',
    subject: 'Shortfall raised on your registration — {{registrationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'A shortfall has been raised on developer registration {{registrationNumber}}:\n{{items}}\n\n' +
      'Respond here: {{link}}\n\n' +
      '{{orgName}}',
    variables: ['registrationNumber', 'items', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_SHORTFALL_RAISED',
    channel: 'SMS',
    subject: '',
    body: 'Shortfall raised on registration {{registrationNumber}}. Respond at {{link}} - {{orgShortName}}',
    variables: ['registrationNumber', 'link', 'orgShortName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_RESPONSE_RECEIVED',
    channel: 'IN_APP',
    subject: 'Shortfall answered — {{registrationNumber}}',
    body: 'The shortfall on {{registrationNumber}} has been answered and is back for review.',
    variables: ['registrationNumber'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_RESPONSE_RECEIVED',
    channel: 'EMAIL',
    subject: 'Shortfall answered — {{registrationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'The shortfall on developer registration {{registrationNumber}} has been answered and is back with the review desk.\n\n' +
      'Open it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: ['registrationNumber', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_RESPONSE_RECEIVED',
    channel: 'SMS',
    subject: '',
    body: 'Shortfall answer received for registration {{registrationNumber}}. - {{orgShortName}}',
    variables: ['registrationNumber', 'orgShortName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_REVIEW_REQUIRED',
    channel: 'IN_APP',
    subject: 'Decision required — {{registrationNumber}}',
    body: '{{registrationNumber}} has been verified and awaits a decision.',
    variables: ['registrationNumber'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_REVIEW_REQUIRED',
    channel: 'EMAIL',
    subject: 'Decision required — {{registrationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Developer registration {{registrationNumber}} has been verified and awaits your decision.\n\n' +
      'Open it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: ['registrationNumber', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_REVIEW_REQUIRED',
    channel: 'SMS',
    subject: '',
    body: 'Registration {{registrationNumber}} verified, awaiting decision. - {{orgShortName}}',
    variables: ['registrationNumber', 'orgShortName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_APPROVED',
    channel: 'IN_APP',
    subject: 'Registration approved — {{registrationNumber}}',
    body: '{{developerName}} is registered as {{registrationNumber}}, valid {{validFrom}} to {{validTo}}.',
    variables: ['registrationNumber', 'developerName', 'validFrom', 'validTo'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_APPROVED',
    channel: 'EMAIL',
    subject: 'Registration approved — {{registrationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Your developer registration {{registrationNumber}} has been approved, valid from {{validFrom}} to {{validTo}}.\n\n' +
      'View it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: ['registrationNumber', 'validFrom', 'validTo', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_APPROVED',
    channel: 'SMS',
    subject: '',
    body: 'Registered as {{registrationNumber}}, valid to {{validTo}}. - {{orgShortName}}',
    variables: ['registrationNumber', 'validTo', 'orgShortName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_REJECTED',
    channel: 'IN_APP',
    subject: 'Registration rejected — {{registrationNumber}}',
    body: 'Developer registration {{registrationNumber}} was rejected: {{decisionRemarks}}',
    variables: ['registrationNumber', 'decisionRemarks'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_REJECTED',
    channel: 'EMAIL',
    subject: 'Registration rejected — {{registrationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Your developer registration {{registrationNumber}} was rejected.\n\nReasons: {{decisionRemarks}}\n\n' +
      'View it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: ['registrationNumber', 'decisionRemarks', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_REJECTED',
    channel: 'SMS',
    subject: '',
    body: 'Registration {{registrationNumber}} was rejected. Details: {{link}} - {{orgShortName}}',
    variables: ['registrationNumber', 'link', 'orgShortName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_RENEWAL_DUE',
    channel: 'IN_APP',
    subject: 'Renewal due — {{registrationNumber}}',
    body: '{{registrationNumber}} is due for renewal; it is valid until {{validTo}}.',
    variables: ['registrationNumber', 'validTo'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_RENEWAL_DUE',
    channel: 'EMAIL',
    subject: 'Renewal due — {{registrationNumber}}',
    body:
      'Dear {{recipientName}},\n\n' +
      'Developer registration {{registrationNumber}} is due for renewal; it is valid until {{validTo}}.\n\n' +
      'Renew it here: {{link}}\n\n' +
      '{{orgName}}',
    variables: ['registrationNumber', 'validTo', 'recipientName', 'link', 'orgName'],
  },
  {
    eventCode: 'DEVELOPER_REGISTRATION_RENEWAL_DUE',
    channel: 'SMS',
    subject: '',
    body: 'Registration {{registrationNumber}} is due for renewal by {{validTo}}. - {{orgShortName}}',
    variables: ['registrationNumber', 'validTo', 'orgShortName'],
  },
];

export async function seedNotifications(prisma: PrismaClient) {
  let created = 0;
  let updated = 0;

  for (const template of TEMPLATES) {
    const existing = await prisma.notificationTemplate.findUnique({
      where: {
        eventCode_channel_locale: {
          eventCode: template.eventCode,
          channel: template.channel,
          locale: 'en',
        },
      },
      select: { id: true },
    });

    if (existing) {
      // `providerTemplateId` is deliberately NOT overwritten: an administrator
      // who has registered a DLT id must not lose it to a redeploy.
      await prisma.notificationTemplate.update({
        where: { id: existing.id },
        data: {
          subject: template.subject,
          body: template.body,
          variables: template.variables,
          isActive: true,
        },
      });
      updated += 1;
    } else {
      await prisma.notificationTemplate.create({
        data: {
          eventCode: template.eventCode,
          channel: template.channel,
          locale: 'en',
          subject: template.subject,
          body: template.body,
          variables: template.variables,
        },
      });
      created += 1;
    }
  }

  const events = new Set(TEMPLATES.map((t) => t.eventCode)).size;
  const sms = TEMPLATES.filter((t) => t.channel === 'SMS').length;

  return { total: TEMPLATES.length, created, updated, events, sms };
}
