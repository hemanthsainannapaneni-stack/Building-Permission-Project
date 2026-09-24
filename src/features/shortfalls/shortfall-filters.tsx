'use client';

import * as React from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { STAGE_LABELS } from '@/lib/workflow';
import { SHORTFALL_STATUS_LABELS } from '@/lib/shortfalls';
import { cn } from '@/lib/utils';
import type { ShortfallFilters } from './types';

/**
 * The register's filter bar.
 *
 * ── Search is debounced; everything else is not ──────────────────────────
 *
 * Typing a reference fires a request per keystroke unless it is held, and a
 * register of thousands is exactly where that is felt. A dropdown is one
 * deliberate choice and applies at once — waiting 300ms after a click looks
 * like the page is broken.
 *
 * ── Advanced filters are collapsed, and say how many are on ──────────────
 *
 * Seven filters permanently open is a wall above a table that most people came
 * to read. They collapse, and the toggle carries a count — so a register
 * showing four rows because somebody narrowed it last week cannot look like a
 * register with four rows in it.
 */

/** Only the desks a file can actually be sitting at. */
const DESK_CODES = Object.keys(STAGE_LABELS);

export const EMPTY_FILTERS: ShortfallFilters = {
  filter: 'open',
  q: '',
  status: '',
  desk: '',
  from: '',
  to: '',
  owner: '',
  applicationId: '',
  attempt: '',
};

/** How many narrowing filters are on, not counting the chip row and search. */
export function activeCount(filters: ShortfallFilters): number {
  return [
    filters.status,
    filters.desk,
    filters.from,
    filters.to,
    filters.owner,
    filters.applicationId,
    filters.attempt,
  ].filter(Boolean).length;
}

// Radix Select cannot hold an empty-string value, so "any" is a sentinel that
// is translated back to "" on the way out. Without it, clearing a Select means
// destroying and remounting it.
const ANY = '__any';
const fromSelect = (value: string): string => (value === ANY ? '' : value);
const toSelect = (value: string): string => value || ANY;

export function ShortfallFilterBar({
  filters,
  onChange,
  onReset,
  disabled,
  showOwner,
}: {
  filters: ShortfallFilters;
  onChange: (next: Partial<ShortfallFilters>) => void;
  onReset: () => void;
  disabled?: boolean;
  /** False for an applicant, who does not need to be told their own name. */
  showOwner: boolean;
}) {
  const count = activeCount(filters);
  const [open, setOpen] = React.useState(count > 0);
  const [draft, setDraft] = React.useState(filters.q);

  // Keeps the box in step when the parent resets, without fighting the user
  // for the caret while they are typing.
  React.useEffect(() => {
    setDraft((current) => (current === filters.q ? current : filters.q));
  }, [filters.q]);

  React.useEffect(() => {
    if (draft === filters.q) return;
    const timer = setTimeout(() => onChange({ q: draft.trim() }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-subtle"
            aria-hidden
          />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Shortfall, application, owner or text"
            aria-label="Search shortfalls"
            className="pl-8 pr-8"
            disabled={disabled}
          />
          {draft && (
            <button
              type="button"
              onClick={() => {
                setDraft('');
                onChange({ q: '' });
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <Button
          type="button"
          variant={open ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="gap-2"
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {count > 0 && <Badge tone="info">{count}</Badge>}
        </Button>

        {(count > 0 || filters.q) && (
          <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={disabled}>
            <X className="size-4" />
            Clear
          </Button>
        )}
      </div>

      {open && (
        <div
          className={cn(
            'grid gap-2.5 rounded border border-border bg-surface-sunk p-3',
            'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
          )}
        >
          <Labelled label="Status">
            <Select
              value={toSelect(filters.status)}
              onValueChange={(v) => onChange({ status: fromSelect(v) })}
              disabled={disabled}
            >
              <SelectTrigger aria-label="Status">
                <SelectValue placeholder="Any status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any status</SelectItem>
                {Object.entries(SHORTFALL_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labelled>

          <Labelled label="Current desk">
            <Select
              value={toSelect(filters.desk)}
              onValueChange={(v) => onChange({ desk: fromSelect(v) })}
              disabled={disabled}
            >
              <SelectTrigger aria-label="Current desk">
                <SelectValue placeholder="Any desk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any desk</SelectItem>
                {DESK_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {STAGE_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labelled>

          <Labelled label="Cycle">
            <Select
              value={toSelect(filters.attempt)}
              onValueChange={(v) => onChange({ attempt: fromSelect(v) })}
              disabled={disabled}
            >
              <SelectTrigger aria-label="Cycle">
                <SelectValue placeholder="Any cycle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any cycle</SelectItem>
                {[2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    Reached cycle {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labelled>

          {showOwner && (
            <Labelled label="Owner">
              <Input
                value={filters.owner}
                onChange={(e) => onChange({ owner: e.target.value })}
                placeholder="Owner or LTP name"
                aria-label="Owner"
                disabled={disabled}
              />
            </Labelled>
          )}

          <Labelled label="Application">
            <Input
              value={filters.applicationId}
              onChange={(e) => onChange({ applicationId: e.target.value.trim() })}
              placeholder="Application id"
              aria-label="Application"
              disabled={disabled}
            />
          </Labelled>

          <Labelled label="Raised from">
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => onChange({ from: e.target.value })}
              aria-label="Raised from"
              disabled={disabled}
            />
          </Labelled>

          <Labelled label="Raised to">
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => onChange({ to: e.target.value })}
              aria-label="Raised to"
              disabled={disabled}
            />
          </Labelled>
        </div>
      )}
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-caption font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}
