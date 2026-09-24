'use client';

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

/**
 * The chart vocabulary. Four shapes, and nothing else.
 *
 * ── Why so few ───────────────────────────────────────────────────────────
 *
 * A dashboard with eleven chart types is a dashboard where every panel has to
 * be learned separately. These four answer the four questions this system
 * actually asks — what is the split, how does it compare, how has it moved,
 * how far along is it — and using the same four everywhere means a reader who
 * has understood one panel has understood all of them.
 *
 * ── Colour ───────────────────────────────────────────────────────────────
 *
 * Every colour is a design token read at paint time as `rgb(var(--token))`,
 * never a literal. That is what makes the charts follow the light and dark
 * themes without a second palette, and it is why a status colour in a chart is
 * the same colour as the badge for that status in the table below it. A chart
 * that invents its own greens is a chart the reader has to translate.
 *
 * Colour is never the only signal: every series is labelled and every value is
 * printed, so the panels remain readable in greyscale and to a reader who
 * cannot separate the hues.
 */

export type Tone = 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'purple' | 'neutral';

export const TONE_COLOR: Record<Tone, string> = {
  primary: 'rgb(var(--primary))',
  info: 'rgb(var(--info))',
  success: 'rgb(var(--success))',
  warning: 'rgb(var(--warning))',
  danger: 'rgb(var(--danger))',
  purple: 'rgb(var(--purple))',
  neutral: 'rgb(var(--text-subtle))',
};

/** The order categorical series are assigned colours in. */
export const SERIES_TONES: Tone[] = ['primary', 'info', 'success', 'warning', 'purple', 'danger', 'neutral'];

export type Slice = { key: string; label: string; value: number; tone: Tone };

const AXIS = {
  stroke: 'rgb(var(--text-subtle))',
  fontSize: 11,
} as const;

/** Recharts renders its own DOM, so the tooltip is styled to match the app. */
function ChartTooltip({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; payload?: Record<string, unknown> }>;
  label?: string | number;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded border border-border bg-surface px-2.5 py-2 shadow-sm">
      {label !== undefined && label !== '' && (
        <p className="mb-1 text-caption font-medium text-text">{String(label)}</p>
      )}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 text-caption text-text-muted">
          <span
            className="size-2 shrink-0 rounded-sm"
            style={{ background: entry.color }}
            aria-hidden
          />
          <span>{entry.name}</span>
          <span className="ml-auto font-medium tabular-nums text-text">
            {typeof entry.value === 'number' ? entry.value.toLocaleString('en-IN') : entry.value}
            {suffix}
          </span>
        </p>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Donut
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A split, with the total in the middle and a legend that carries the numbers.
 *
 * The legend is not decoration. A donut is poor at letting anyone read a value
 * off it, so the values are printed beside the labels and the ring is left to
 * do the one thing it is good at — showing which share is large.
 */
export function DonutChart({
  slices,
  total,
  totalLabel,
  height = 200,
  className,
}: {
  slices: Slice[];
  total?: number;
  totalLabel?: string;
  height?: number;
  className?: string;
}) {
  const shown = slices.filter((s) => s.value > 0);
  const sum = total ?? shown.reduce((acc, s) => acc + s.value, 0);

  if (!shown.length) {
    return (
      <p className={cn('py-8 text-center text-small text-text-subtle', className)}>
        Nothing to chart yet.
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-center', className)}>
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart style={{ outline: 'none' }}>
            <Pie
              data={shown}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              cornerRadius={6}
              stroke="rgb(var(--surface))"
              strokeWidth={2}
              isAnimationActive={false}
              style={{ outline: 'none' }}
            >
              {shown.map((slice) => (
                <Cell key={slice.key} fill={TONE_COLOR[slice.tone]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-semibold leading-none tabular-nums text-text">
            {sum.toLocaleString('en-IN')}
          </span>
          {totalLabel && (
            <span className="mt-1 text-caption uppercase tracking-wide text-text-subtle">
              {totalLabel}
            </span>
          )}
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {shown.map((slice) => (
          <li key={slice.key} className="flex items-baseline gap-2 text-small">
            <span
              className="size-2 shrink-0 translate-y-[-1px] rounded-sm"
              style={{ background: TONE_COLOR[slice.tone] }}
              aria-hidden
            />
            <span className="min-w-0 truncate text-text-muted">{slice.label}</span>
            <span className="ml-auto shrink-0 font-medium tabular-nums text-text">
              {slice.value.toLocaleString('en-IN')}
            </span>
            <span className="w-10 shrink-0 text-right tabular-nums text-caption text-text-subtle">
              {sum ? Math.round((slice.value / sum) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Horizontal bars
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A ranked comparison — pendency by desk, shortfalls by kind.
 *
 * Horizontal because the labels are words rather than dates: a vertical bar
 * chart with "Addl Commissioner" under it either truncates the label or turns
 * it on its side, and both make the chart harder to read than the table it
 * replaced.
 */
export function BarList({
  rows,
  emptyLabel = 'Nothing here yet.',
  className,
}: {
  rows: Array<{ key: string; label: string; value: number; tone?: Tone; href?: string }>;
  emptyLabel?: string;
  className?: string;
}) {
  const shown = rows.filter((r) => r.value > 0);

  if (!shown.length) {
    return <p className={cn('py-6 text-center text-small text-text-subtle', className)}>{emptyLabel}</p>;
  }

  return (
    <div className={cn('h-64 w-full pt-4', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={shown} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--border))" />
          <XAxis 
            dataKey="label" 
            tick={{ fontSize: 11, fill: 'rgb(var(--text-subtle))' }} 
            tickLine={false} 
            axisLine={false} 
            dy={8}
          />
          <YAxis 
            tick={{ fontSize: 11, fill: 'rgb(var(--text-subtle))' }} 
            tickLine={false} 
            axisLine={false} 
            dx={-8}
          />
          <Tooltip 
            cursor={{ fill: 'rgba(0,0,0, 0.05)' }}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="rounded border border-border bg-surface px-3 py-2 shadow-sm">
                    <p className="text-small font-medium text-text">{payload[0]?.payload?.label}</p>
                    <p className="text-small font-bold text-text-muted mt-0.5">{payload[0]?.value}</p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="value" radius={[12, 12, 12, 12]} maxBarSize={24}>
            {shown.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={TONE_COLOR[entry.tone ?? 'primary']} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Trend
// ═══════════════════════════════════════════════════════════════════════════

export type TrendSeries = { key: string; label: string; tone: Tone };

/** Movement over time. Lines, because the reader is looking for a direction. */
export function TrendChart({
  data,
  series,
  height = 220,
  className,
}: {
  data: Array<Record<string, string | number>>;
  series: TrendSeries[];
  height?: number;
  className?: string;
}) {
  const empty = data.every((point) => series.every((s) => Number(point[s.key] ?? 0) === 0));

  if (empty) {
    return (
      <p className={cn('py-10 text-center text-small text-text-subtle', className)}>
        No activity in this window yet.
      </p>
    );
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={38} {...AXIS} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgb(var(--border-strong))' }} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={TONE_COLOR[s.tone]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-caption text-text-muted">
            <span
              className="h-0.5 w-3 shrink-0 rounded-sm"
              style={{ background: TONE_COLOR[s.tone] }}
              aria-hidden
            />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Grouped columns
// ═══════════════════════════════════════════════════════════════════════════

/** A comparison across a handful of named groups. */
export function ColumnChart({
  data,
  series,
  height = 200,
  className,
}: {
  data: Array<Record<string, string | number>>;
  series: TrendSeries[];
  height?: number;
  className?: string;
}) {
  if (!data.length) {
    return (
      <p className={cn('py-10 text-center text-small text-text-subtle', className)}>
        Nothing to compare yet.
      </p>
    );
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={38} {...AXIS} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(var(--surface-sunk))' }} />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={TONE_COLOR[s.tone]}
              radius={[2, 2, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Progress
// ═══════════════════════════════════════════════════════════════════════════

/** How far along one quantity is against another. Used for money, mostly. */
export function ProgressBar({
  value,
  total,
  tone = 'success',
  label,
  valueLabel,
  className,
}: {
  value: number;
  total: number;
  tone?: Tone;
  label?: string;
  valueLabel?: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;

  return (
    <div className={className}>
      {(label || valueLabel) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label && <span className="text-small text-text-muted">{label}</span>}
          {valueLabel && (
            <span className="text-small font-medium tabular-nums text-text">{valueLabel}</span>
          )}
        </div>
      )}
      <div
        className="h-2 overflow-hidden rounded-sm bg-surface-sunk"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full rounded-sm" style={{ width: `${pct}%`, background: TONE_COLOR[tone] }} />
      </div>
      <p className="mt-1 text-caption tabular-nums text-text-subtle">{pct}%</p>
    </div>
  );
}
