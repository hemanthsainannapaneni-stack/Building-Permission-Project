import 'server-only';
import { prisma, type Db } from '@/server/db/prisma';
import { audit } from './audit';
import { badRequest } from '@/server/http/errors';
import type { AuthUser } from '@/server/auth/context';

/**
 * Business configuration — tier two of the two-tier config model
 * (docs/00-architecture.md A.6).
 *
 * Environment holds secrets and infrastructure. This holds the rules the
 * department may change: SLA behaviour, rounding, mock scrutiny behaviour.
 * Editable in the admin UI, effective immediately, every change audited.
 *
 * Per architectural Rule 6, any behaviour the business has not specified lives
 * here with a safe restrictive default — never hard-coded, and never guessed.
 */

export type SettingsMap = Record<string, string | number | boolean | unknown>;

let cache: { data: SettingsMap; expiresAt: number } | null = null;
const TTL_MS = 30_000;

export async function getSettings(force = false): Promise<SettingsMap> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.data;

  const rows = await prisma.systemSetting.findMany();
  const data: SettingsMap = {};

  for (const row of rows) {
    data[row.key] = coerce(row.value, row.type);
  }

  cache = { data, expiresAt: Date.now() + TTL_MS };
  return data;
}

export function invalidateSettingsCache() {
  cache = null;
}

function coerce(value: string, type: string): string | number | boolean | unknown {
  switch (type) {
    case 'NUMBER': {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'BOOLEAN':
      return value === 'true' || value === '1';
    case 'JSON':
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    default:
      return value;
  }
}

// ── Typed accessors ──────────────────────────────────────────────────────
// Each takes an explicit fallback, so a missing row degrades to the safe
// default rather than to `undefined` somewhere downstream.

export async function settingString(key: string, fallback = ''): Promise<string> {
  const v = (await getSettings())[key];
  return typeof v === 'string' ? v : fallback;
}

export async function settingNumber(key: string, fallback = 0): Promise<number> {
  const v = (await getSettings())[key];
  return typeof v === 'number' ? v : fallback;
}

export async function settingBool(key: string, fallback = false): Promise<boolean> {
  const v = (await getSettings())[key];
  return typeof v === 'boolean' ? v : fallback;
}

export async function settingJson<T>(key: string, fallback: T): Promise<T> {
  const v = (await getSettings())[key];
  return v === null || v === undefined ? fallback : (v as T);
}

// ── Writing ──────────────────────────────────────────────────────────────

export async function updateSetting(
  db: Db,
  key: string,
  value: string,
  actor: AuthUser,
  meta: { ip?: string; userAgent?: string; correlationId?: string } = {}
) {
  const before = await db.systemSetting.findUnique({ where: { key } });
  if (!before) throw new Error(`Unknown setting: ${key}`);

  const after = await db.systemSetting.update({
    where: { key },
    data: { value, updatedById: actor.id },
  });

  await audit(db, {
    actor,
    action: 'SETTING_UPDATED',
    entityType: 'SystemSetting',
    entityId: key,
    // A secret's value is never written into the audit trail.
    before: before.isSecret ? { key, value: '[redacted]' } : { key, value: before.value },
    after: after.isSecret ? { key, value: '[redacted]' } : { key, value: after.value },
    ...meta,
  });

  invalidateSettingsCache();
  return after;
}

/** Strips secret values before anything is serialised to a client. */
export function redactSecrets<T extends { key: string; value: string; isSecret: boolean }>(rows: T[]): T[] {
  return rows.map((row) => (row.isSecret ? { ...row, value: row.value ? '[set]' : '' } : row));
}

// ── The admin console ────────────────────────────────────────────────────

/**
 * How a group of settings is presented, and in what order.
 *
 * The `group` column already carries the grouping; this adds the human title
 * and the sentence explaining what the group is FOR. Both live here rather
 * than in the page so that a group added by a later seed appears in the UI
 * with a sensible fallback rather than as an unexplained accordion.
 */
export const SETTING_GROUPS: Array<{ key: string; title: string; description: string }> = [
  {
    key: 'general',
    title: 'General',
    description: 'Organisation identity and the conventions every screen inherits.',
  },
  {
    key: 'applications',
    title: 'Applications',
    description: 'How applications are numbered and what a filed application must carry.',
  },
  {
    key: 'workflow',
    title: 'Workflow',
    description:
      'How the engine routes and assigns work. Routing itself is configuration in workflow_transitions — these are the behaviours around it.',
  },
  {
    key: 'sla',
    title: 'Service standards',
    description:
      'Target turnaround, the warning threshold, and who is told. Passing a due date notifies and reports; it never approves, rejects or moves an application.',
  },
  {
    key: 'scrutiny',
    title: 'Automated scrutiny',
    description: 'The drawing-check provider and the behaviour of the demonstration engine.',
  },
  {
    key: 'documents',
    title: 'Documents',
    description: 'What counts as a complete document set.',
  },
  {
    key: 'fees',
    title: 'Fees',
    description:
      'Demand numbering, rounding and payment windows. The rates themselves are a fee STRUCTURE, versioned separately, not a setting.',
  },
  {
    key: 'payments',
    title: 'Payments',
    description: 'Gateway behaviour, attempt windows and reconciliation.',
  },
  {
    key: 'notifications',
    title: 'Notifications',
    description: 'Which channels are used and how templates are resolved.',
  },
  {
    key: 'developers',
    title: 'Developer registration',
    description: 'Validity and renewal window for developer registrations. Demonstration values; no published rule sets them.',
  },
  {
    key: 'professionals',
    title: 'LTP registration',
    description: 'Validity and renewal window for LTP registrations. Demonstration values; a registration never outlives the licence itself.',
  },
  {
    key: 'security',
    title: 'Security',
    description: 'Session and sign-in behaviour that is policy rather than infrastructure.',
  },
];

export type SettingRow = {
  key: string;
  value: string;
  type: string;
  group: string;
  label: string;
  description: string;
  isSecret: boolean;
  updatedAt: string;
};

/** Every setting, secrets redacted, grouped for the console. */
export async function listSettings(): Promise<{
  groups: Array<{ key: string; title: string; description: string; settings: SettingRow[] }>;
  total: number;
}> {
  const rows = await prisma.systemSetting.findMany({
    orderBy: [{ group: 'asc' }, { key: 'asc' }],
    select: {
      key: true,
      value: true,
      type: true,
      group: true,
      label: true,
      description: true,
      isSecret: true,
      updatedAt: true,
    },
  });

  const safe = redactSecrets(rows).map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  }));

  const byGroup = new Map<string, SettingRow[]>();
  for (const row of safe) {
    byGroup.set(row.group, [...(byGroup.get(row.group) ?? []), row]);
  }

  // Known groups first, in the order above; anything a later seed introduces
  // is appended rather than dropped.
  const known = SETTING_GROUPS.filter((g) => byGroup.has(g.key)).map((g) => ({
    ...g,
    settings: byGroup.get(g.key)!,
  }));

  const extra = [...byGroup.keys()]
    .filter((key) => !SETTING_GROUPS.some((g) => g.key === key))
    .sort()
    .map((key) => ({
      key,
      title: key.charAt(0).toUpperCase() + key.slice(1),
      description: '',
      settings: byGroup.get(key)!,
    }));

  return { groups: [...known, ...extra], total: safe.length };
}

/**
 * Applies a batch of edits in one transaction.
 *
 * ── Validation happens against the ROW, not the request ─────────────────
 *
 * A setting's `type` decides what its value may be, and the request does not
 * get to say. "yes" against a BOOLEAN and "soon" against a NUMBER are both
 * refused here rather than being stored and coerced to `false` and `0` by the
 * typed accessors — which is how a service standard silently becomes zero
 * days and nobody is told.
 *
 * ── Secrets are never overwritten by the redacted placeholder ───────────
 *
 * `listSettings` sends `[set]` in place of a secret. Posting the form back
 * unchanged would therefore store the literal string `[set]` as, say, a
 * webhook secret. A secret whose submitted value is exactly the placeholder is
 * treated as "unchanged" and skipped.
 */
export async function updateSettings(
  changes: Array<{ key: string; value: string }>,
  actor: AuthUser,
  meta: { ip?: string; userAgent?: string; correlationId?: string } = {}
): Promise<{ updated: number; skipped: string[] }> {
  const keys = changes.map((c) => c.key);

  const existing = await prisma.systemSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true, type: true, isSecret: true },
  });

  const byKey = new Map(existing.map((row) => [row.key, row]));

  const unknown = keys.filter((key) => !byKey.has(key));
  if (unknown.length) {
    throw badRequest(
      `No such setting: ${unknown.join(', ')}. Settings are seeded, not created from the console.`,
      unknown.map((key) => ({ path: key, message: 'Unknown setting key.' }))
    );
  }

  const problems: Array<{ path: string; message: string }> = [];
  const skipped: string[] = [];
  const applicable: Array<{ key: string; value: string }> = [];

  for (const change of changes) {
    const row = byKey.get(change.key)!;

    if (row.isSecret && change.value === REDACTED) {
      skipped.push(change.key);
      continue;
    }

    if (change.value === row.value) {
      skipped.push(change.key);
      continue;
    }

    const problem = validateAgainstType(change.value, row.type);
    if (problem) {
      problems.push({ path: change.key, message: problem });
      continue;
    }

    applicable.push(change);
  }

  if (problems.length) {
    throw badRequest('Some values are not valid for their setting type.', problems);
  }

  if (!applicable.length) return { updated: 0, skipped };

  // One transaction: a half-applied group is worse than an unchanged one.
  await prisma.$transaction(async (tx) => {
    for (const change of applicable) {
      await updateSetting(tx, change.key, change.value, actor, meta);
    }
  });

  invalidateSettingsCache();
  return { updated: applicable.length, skipped };
}

const REDACTED = '[set]';

/** Returns a problem sentence, or null when the value fits the type. */
function validateAgainstType(value: string, type: string): string | null {
  switch (type) {
    case 'NUMBER':
      return Number.isFinite(Number(value)) && value.trim() !== ''
        ? null
        : 'This setting takes a number.';
    case 'BOOLEAN':
      return value === 'true' || value === 'false'
        ? null
        : 'This setting takes true or false.';
    case 'JSON':
      try {
        JSON.parse(value);
        return null;
      } catch {
        return 'This setting takes valid JSON.';
      }
    default:
      return null;
  }
}
