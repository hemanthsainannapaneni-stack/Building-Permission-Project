import type { PrismaClient } from '@prisma/client';

/**
 * Business configuration — tier two of the config model.
 *
 * Every rule the department has not specified in writing lives here with a
 * SAFE RESTRICTIVE DEFAULT, per architectural Rule 6. An administrator can
 * change any of these in the admin UI; nobody has to change code.
 *
 * Note what is absent: there is no setting that permits approving an
 * application with an open shortfall, and none that lets an SLA breach move an
 * application. Those are decisions (D3, D2), not configuration.
 */

type Seed = {
  key: string;
  value: string;
  type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';
  group: string;
  label: string;
  description: string;
};

export const SETTINGS: Seed[] = [
  // ── General ───────────────────────────────────────────────────────────
  {
    key: 'org_name',
    value: 'Municipal Corporation',
    type: 'STRING',
    group: 'general',
    label: 'Organisation name',
    description: 'Printed on orders, receipts and notifications.',
  },
  {
    key: 'org_short_name',
    value: 'LAMS',
    type: 'STRING',
    group: 'general',
    label: 'Short name',
    description: 'Used as the SMS sender signature.',
  },
  {
    key: 'support_email',
    value: 'support@example.gov.in',
    type: 'STRING',
    group: 'general',
    label: 'Support email',
    description: 'Shown to applicants who need help.',
  },

  // ── Applications ──────────────────────────────────────────────────────
  {
    key: 'application_number_format',
    value: '{prefix}/{year}/{seq:6}',
    type: 'STRING',
    group: 'applications',
    label: 'Application number format',
    description:
      'Tokens: {prefix} {year} {seq:n}. No mandated format was supplied — open question Q16.',
  },
  {
    key: 'allow_withdraw_after_submission',
    value: 'false',
    type: 'BOOLEAN',
    group: 'applications',
    label: 'Allow withdrawal after submission',
    description: 'Restrictive default: withdrawal rules were not specified (Q22).',
  },

  // ── Documents ─────────────────────────────────────────────────────────
  {
    key: 'documents_complete_requires_verification',
    value: 'false',
    type: 'BOOLEAN',
    group: 'documents',
    label: 'Completeness requires officer verification',
    description:
      'When false, an uploaded mandatory document counts as complete. Verification then happens at TPA, after payment (Q9).',
  },

  // ── Fees and payment ──────────────────────────────────────────────────
  {
    key: 'fee_rounding_rule',
    value: 'NEAREST_1',
    type: 'STRING',
    group: 'fees',
    label: 'Fee rounding',
    description: 'NONE | NEAREST_1 | NEAREST_10 | UP_10.',
  },
  {
    key: 'fee_demand_number_format',
    value: '{prefix}/{year}/{seq:6}',
    type: 'STRING',
    group: 'fees',
    label: 'Demand number format',
    description:
      'Tokens: {prefix} {year} {seq:n}. The prefix for a fee demand is DM. Same shape as the application number format.',
  },
  {
    key: 'fee_demand_due_days',
    value: '0',
    type: 'NUMBER',
    group: 'fees',
    label: 'Days a demand is payable within',
    description:
      'Zero means the demand carries no due date. Restrictive default: no payment deadline was supplied (Q8), and printing an invented date on a demand would give it an authority it does not have.',
  },
  {
    key: 'allow_partial_payment',
    value: 'false',
    type: 'BOOLEAN',
    group: 'payments',
    label: 'Allow partial payment of a demand',
    description: 'Restrictive default: a demand is paid in full (Q8).',
  },
  {
    key: 'fees_refundable_on_rejection',
    value: 'false',
    type: 'BOOLEAN',
    group: 'payments',
    label: 'Fees refundable on rejection',
    description: 'Restrictive default: no refund policy was supplied (Q8).',
  },
  {
    key: 'payment_attempt_ttl_minutes',
    value: '30',
    type: 'NUMBER',
    group: 'payments',
    label: 'How long a payment attempt stays open (minutes)',
    description:
      'After this an unsettled attempt becomes TIMEOUT and the LTP may start a new one. It does NOT stop the sweep verifying: a timed-out attempt is still checked for up to the give-up window, because a gateway that answers late has still taken money.',
  },
  {
    key: 'payment_reconcile_after_minutes',
    value: '10',
    type: 'NUMBER',
    group: 'payments',
    label: 'Verify unsettled payments older than (minutes)',
    description:
      'The sweep leaves a fresh attempt alone — the payer is probably still at the gateway. Past this age it asks the gateway directly, which is what catches the payer who closed the browser.',
  },
  {
    key: 'payment_reconcile_give_up_hours',
    value: '24',
    type: 'NUMBER',
    group: 'payments',
    label: 'Keep verifying for (hours)',
    description:
      'How long the sweep keeps asking about an unsettled attempt. Deliberately long: a net-banking payment can settle hours later, and giving up early means a citizen has paid and the system does not know.',
  },
  {
    key: 'payment_receipt_number_format',
    value: '{prefix}/{year}/{seq:6}',
    type: 'STRING',
    group: 'payments',
    label: 'Receipt number format',
    description:
      'Tokens: {prefix} {year} {seq:n}. The prefix for a receipt is RC. Allocated gap-free from number_sequences inside the settlement transaction.',
  },

  // ── The mock gateway ──────────────────────────────────────────────────
  //
  // Behaviour of MockPaymentProvider, which moves no money. These exist so a
  // demonstration and the test suite can drive every outcome — success,
  // failure, cancellation, a gateway that never answers, and an amount
  // mismatch — without a real gateway and without code changes.
  {
    key: 'mock_payment_mode',
    value: 'MANUAL',
    type: 'STRING',
    group: 'payments',
    label: 'Mock gateway outcome mode',
    description:
      'MANUAL | AUTO_SUCCESS | AUTO_FAILURE | AUTO_CANCEL | AUTO_PENDING. MANUAL waits for someone to press a button on the demo gateway page, which is what a demonstration wants; the AUTO modes answer immediately, which is what tests want.',
  },
  {
    key: 'mock_payment_delay_ms',
    value: '0',
    type: 'NUMBER',
    group: 'payments',
    label: 'Simulated gateway latency (ms)',
    description: 'Applied when a payment is initiated, to make the processing screen visible in a demonstration.',
  },
  {
    key: 'mock_payment_amount_delta',
    value: '0',
    type: 'NUMBER',
    group: 'payments',
    label: 'Mock gateway amount discrepancy (rupees)',
    description:
      'Added to the amount the mock gateway claims was paid. Non-zero exercises the amount-mismatch refusal, which must never partially credit a demand. Leave at zero outside a test.',
  },

  // ── Scrutiny ──────────────────────────────────────────────────────────
  {
    key: 'mock_scrutiny_mode',
    value: 'VERSION_LADDER',
    type: 'STRING',
    group: 'scrutiny',
    label: 'Mock scrutiny outcome mode',
    description: 'VERSION_LADDER | ALWAYS_PASS | ALWAYS_FAIL | SEEDED_RANDOM.',
  },
  {
    key: 'mock_scrutiny_pass_from_version',
    value: '3',
    type: 'NUMBER',
    group: 'scrutiny',
    label: 'Pass from drawing version',
    description: 'Under VERSION_LADDER, the version at which the mock starts passing.',
  },
  {
    key: 'mock_scrutiny_delay_ms',
    value: '3000',
    type: 'NUMBER',
    group: 'scrutiny',
    label: 'Simulated engine latency (ms)',
    description: 'Keeps the async pipeline genuinely asynchronous rather than accidentally instant.',
  },
  {
    key: 'mock_scrutiny_error_rate',
    value: '0',
    type: 'NUMBER',
    group: 'scrutiny',
    label: 'Simulated error rate',
    description: 'Fraction of runs that error rather than returning a result, to exercise retries.',
  },

  // ── SLA ───────────────────────────────────────────────────────────────
  {
    key: 'sla_pause_on_shortfall',
    value: 'true',
    type: 'BOOLEAN',
    group: 'sla',
    label: 'Pause the clock during a shortfall',
    description: 'An officer should not be scored for an applicant delay (Q12).',
  },
  {
    key: 'sla_warn_at_percent',
    value: '70',
    type: 'NUMBER',
    group: 'sla',
    label: 'Warn at % of the SLA elapsed',
    description: 'When a task starts showing as due soon.',
  },

  // ── Shortfalls ────────────────────────────────────────────────────────
  {
    key: 'shortfall_number_format',
    value: '{prefix}/{year}/{seq:5}',
    type: 'STRING',
    group: 'workflow',
    label: 'Shortfall reference format',
    description: 'Tokens: {prefix} {year} {seq} {seq:n}. Renders as SF/2026/00001.',
  },
  {
    key: 'approval_order_number_format',
    value: '{prefix}/{year}/{seq:5}',
    type: 'STRING',
    group: 'workflow',
    label: 'Approval order number format',
    description: 'Tokens: {prefix} {year} {seq} {seq:n}. Renders as BPO/2026/00001.',
  },
  {
    key: 'shortfall_response_days',
    value: '0',
    type: 'NUMBER',
    group: 'workflow',
    label: 'Days an applicant has to answer a shortfall',
    description:
      'Sets the due date shown on a shortfall. 0 = no date, which is the default because no statutory response period has been supplied (Q13) and inventing one would put a deadline on an applicant that no rule supports.',
  },

  // ── Notifications ─────────────────────────────────────────────────────
  {
    key: 'notifications_email_enabled',
    value: 'true',
    type: 'BOOLEAN',
    group: 'notifications',
    label: 'Email notifications enabled',
    description: '',
  },
  {
    key: 'notifications_sms_enabled',
    value: 'true',
    type: 'BOOLEAN',
    group: 'notifications',
    label: 'SMS notifications enabled',
    description: 'The SMS adapter still refuses to send without a registered DLT template id.',
  },
  {
    key: 'notify_applicant_directly',
    value: 'true',
    type: 'BOOLEAN',
    group: 'notifications',
    label: 'Message the applicant as well as the LTP',
    description:
      'The LTP holds the account and does the work; the applicant is the citizen whose building it is. With this on, both are told when a decision or a shortfall affects the application. Turn it off for a department that corresponds only with the LTP.',
  },
  {
    key: 'notifications_quiet_hours',
    value: '{"start":"21:00","end":"07:00"}',
    type: 'JSON',
    group: 'notifications',
    label: 'SMS quiet hours',
    description: 'SMS defers to the next window. Email and in-app are unaffected.',
  },

  // ── Developer registration (DEMO values — no published rule) ─────────
  {
    key: 'developer_registration_validity_years',
    value: '3',
    type: 'NUMBER',
    group: 'developers',
    label: 'Registration validity (years)',
    description:
      'DEMO VALUE. How long an approved developer registration runs. Applies to registrations approved after a change; issued ones keep their dates.',
  },
  {
    key: 'developer_renewal_window_days',
    value: '90',
    type: 'NUMBER',
    group: 'developers',
    label: 'Renewal window (days before expiry)',
    description: 'DEMO VALUE. Renewal opens, and the registration is listed as due, this many days before it expires.',
  },

  // ── Professional registration (DEMO values — no statutory period) ─────
  {
    key: 'professional_registration_validity_years',
    value: '3',
    type: 'NUMBER',
    group: 'professionals',
    label: 'Registration validity (years)',
    description:
      'DEMO VALUE. How long an approved LTP registration runs — never past the licence’s own validity. Issued registrations keep their dates.',
  },
  {
    key: 'professional_renewal_window_days',
    value: '60',
    type: 'NUMBER',
    group: 'professionals',
    label: 'Renewal window (days before expiry)',
    description: 'DEMO VALUE. Renewal opens, and the registration is listed as due, this many days before it expires.',
  },

  // ── Security ──────────────────────────────────────────────────────────
  {
    key: 'password_min_length',
    value: '10',
    type: 'NUMBER',
    group: 'security',
    label: 'Minimum password length',
    description: 'Length-led rather than composition-led: composition rules produce Password1!.',
  },
  {
    key: 'session_idle_minutes',
    value: '480',
    type: 'NUMBER',
    group: 'security',
    label: 'Idle session timeout (minutes)',
    description: 'Informational mirror of SESSION_IDLE_TTL_HOURS.',
  },
];

export async function seedSettings(prisma: PrismaClient) {
  let created = 0;

  for (const s of SETTINGS) {
    const existing = await prisma.systemSetting.findUnique({ where: { key: s.key } });

    if (!existing) {
      await prisma.systemSetting.create({ data: s });
      created += 1;
      continue;
    }

    // An administrator's edited VALUE is never overwritten by a re-seed —
    // only the label, description and grouping are refreshed. Re-running the
    // seed must not silently undo somebody's configuration change.
    await prisma.systemSetting.update({
      where: { key: s.key },
      data: { type: s.type, group: s.group, label: s.label, description: s.description },
    });
  }

  return { total: SETTINGS.length, created, preserved: SETTINGS.length - created };
}
