'use client';

import type { Option } from '@/lib/bim';

/**
 * A native select styled like the inputs beside it. The BIM tab has two dozen
 * coded fields; a native control keeps each one keyboard- and
 * autofill-friendly without a portal per field.
 */
export function NativeSelect({
  id,
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Not stated',
}: {
  id: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Shown as the empty choice. Omit the empty choice by passing null. */
  placeholder?: string | null;
}) {
  return (
    <select
      id={id}
      className="h-9 w-full rounded border border-border-strong bg-surface px-2 text-small text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-surface-sunk disabled:opacity-60"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder !== null && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
          {o.hint ? ` — ${o.hint}` : ''}
        </option>
      ))}
    </select>
  );
}
