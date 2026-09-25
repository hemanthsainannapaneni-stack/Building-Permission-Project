import 'server-only';
import type { Tx } from '@/server/db/prisma';
import { settingString } from './settings';

/**
 * Reference-number allocation.
 *
 * ONE number, ONE application, no gaps, no duplicates — including when two
 * LTPs press Submit in the same millisecond.
 *
 * How that is achieved, and why it is not the obvious way:
 *
 *   SELECT current FROM number_sequences WHERE scope = $1;   ← DON'T
 *   UPDATE number_sequences SET current = $2 WHERE scope = $1;
 *
 * That read-modify-write races: two transactions read 41, both write 42, and
 * two applications are issued BP/2026/000042. The unique index on
 * `applications.applicationNumber` would reject the second — but only after
 * the user filled in a ten-step form, which is a poor place to discover it.
 *
 * Instead the increment is a SINGLE statement:
 *
 *   INSERT INTO number_sequences (scope, current) VALUES ($1, 1)
 *   ON CONFLICT (scope) DO UPDATE SET current = number_sequences.current + 1
 *   RETURNING current;
 *
 * Postgres takes a row lock for the duration of that statement, so a second
 * concurrent caller blocks and then reads the value the first actually wrote.
 * It returns 42 and 43, never 42 twice. The row is created on first use, so
 * there is no seeding step and no "sequence not found" failure mode.
 *
 * GAP-FREE follows from calling this INSIDE the caller's transaction: the
 * allocation and the application row commit together, or neither does. That is
 * the opposite trade-off to a Postgres SEQUENCE, which never blocks but leaves
 * holes on rollback. A statutory register with missing numbers invites the
 * question "what happened to BP/2026/000042?", and there must always be an
 * answer.
 *
 * The cost is that concurrent filings serialise on one row for the length of
 * the transaction. At the volume of a building-permission office that is
 * nothing; if it ever became something, the fix is a shorter transaction, not
 * a racier allocator.
 */

/**
 * Allocates the next value for a scope. Must be called inside a transaction.
 *
 * @param tx    The caller's transaction client — not the base client.
 * @param scope Any stable string. Application numbers scope per prefix and
 *              year, so each year restarts at 1.
 */
export async function nextSequence(tx: Tx, scope: string): Promise<number> {
  const row = await tx.numberSequence.upsert({
    where: { scope },
    create: { scope, current: 1 },
    update: { current: { increment: 1 } },
  });

  return row.current;
}

/**
 * Renders a number from the configured format.
 *
 * The format lives in the `application_number_format` setting because no
 * mandated format was supplied (open question Q16) — per architectural Rule 6
 * it is configuration with a safe default, not a hard-coded guess.
 *
 * Tokens:  {prefix}  {year}  {seq}  {seq:n}   — n = zero-padded width.
 */
export function formatNumber(
  template: string,
  parts: { prefix: string; year: number; seq: number }
): string {
  return template
    .replace(/\{prefix\}/g, parts.prefix)
    .replace(/\{year\}/g, String(parts.year))
    .replace(/\{seq(?::(\d+))?\}/g, (_match, width?: string) =>
      width ? String(parts.seq).padStart(Number(width), '0') : String(parts.seq)
    );
}

export const DEFAULT_NUMBER_FORMAT = '{prefix}/{year}/{seq:6}';

/**
 * The application number: `BP/2026/000001`.
 *
 * The prefix comes from the application TYPE (`application_types.numberPrefix`)
 * rather than being fixed, so a layout approval reads LP/2026/000001 and is
 * distinguishable from a building permission at a glance — which is what the
 * column was put there for in Phase 1.
 *
 * The year is the CALENDAR year of filing. An Indian department may well want
 * the financial year instead; that has not been specified, so the visible,
 * changeable default is the one that matches the format's own `{year}` token.
 * Changing it is a change to this function and the scope string, together.
 *
 * Must be called inside the same transaction that inserts the application.
 */
export async function allocateApplicationNumber(
  tx: Tx,
  prefix: string,
  now: Date = new Date(),
  configuredTemplate?: string
): Promise<{ applicationNumber: string; sequence: number; scope: string }> {
  const year = now.getFullYear();

  // Scoped per prefix AND year, so each year restarts at 1 and BP and LP
  // never share a counter.
  const scope = `application:${prefix}:${year}`;
  const seq = await nextSequence(tx, scope);

  const template = configuredTemplate ?? (await settingString('application_number_format', DEFAULT_NUMBER_FORMAT));

  return {
    applicationNumber: formatNumber(template || DEFAULT_NUMBER_FORMAT, { prefix, year, seq }),
    sequence: seq,
    scope,
  };
}
