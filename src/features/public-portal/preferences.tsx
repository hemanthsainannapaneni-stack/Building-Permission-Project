'use client';

import * as React from 'react';
import Link from 'next/link';
import { Contrast, Headphones } from 'lucide-react';
import { SCREEN_READER_LINK } from '@/lib/public-portal';
import { cn } from '@/lib/utils';

/**
 * The accessibility bar: Skip to Main Content, A+ / A / A-, contrast, Screen
 * Reader Access.
 *
 * ── How the controls work ───────────────────────────────────────────────
 *
 * Text size is one of four steps (90%, 100%, 112.5%, 125%) written to
 * `data-public-text-size` on <html>, where globals.css scales the root font
 * size. Contrast is `data-public-contrast="high"`. Both are remembered in
 * localStorage so they survive a reload, and BOTH ARE REMOVED when the visitor
 * leaves the portal for the workspace: the root layout is shared, so an
 * attribute left on <html> would otherwise enlarge a screen that never asked
 * for it.
 *
 * localStorage can throw (private windows, blocked storage) and the controls
 * must not break the page when it does — every access is guarded, and the
 * buttons still work for the current visit.
 */

const SIZE_KEY = 'nirman.public.textSize';
const CONTRAST_KEY = 'nirman.public.contrast';
const STEPS = [-1, 0, 1, 2] as const;
type Step = (typeof STEPS)[number];
const PERCENT: Record<Step, number> = { '-1': 90, '0': 100, '1': 112.5, '2': 125 };

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* the setting still applies for this visit */
  }
};

export function Preferences() {
  const [step, setStep] = React.useState<Step>(0);
  const [high, setHigh] = React.useState(false);
  const [announce, setAnnounce] = React.useState('');

  // Restore what the visitor chose last time.
  React.useEffect(() => {
    const saved = Number(read(SIZE_KEY));
    if ((STEPS as readonly number[]).includes(saved)) setStep(saved as Step);
    setHigh(read(CONTRAST_KEY) === 'high');
  }, []);

  // Apply, and undo on the way out.
  React.useEffect(() => {
    const root = document.documentElement;
    if (step === 0) root.removeAttribute('data-public-text-size');
    else root.setAttribute('data-public-text-size', String(step));
    if (high) root.setAttribute('data-public-contrast', 'high');
    else root.removeAttribute('data-public-contrast');
  }, [step, high]);
  React.useEffect(() => {
    const root = document.documentElement;
    return () => {
      root.removeAttribute('data-public-text-size');
      root.removeAttribute('data-public-contrast');
    };
  }, []);

  const setSize = (next: Step) => {
    setStep(next);
    write(SIZE_KEY, String(next));
    setAnnounce(`Text size ${PERCENT[next]} percent`);
  };
  const toggleContrast = () => {
    const next = !high;
    setHigh(next);
    write(CONTRAST_KEY, next ? 'high' : 'normal');
    setAnnounce(next ? 'High contrast on' : 'High contrast off');
  };

  const btn = 'inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-caption font-semibold text-white ring-1 ring-white/30 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <a href="#main-content" className="rounded px-1 text-caption font-medium text-white underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-white">
        Skip to Main Content
      </a>
      <div role="group" aria-label="Text size" className="flex items-center gap-1">
        <button type="button" className={btn} onClick={() => setSize(Math.min(2, step + 1) as Step)} disabled={step === 2} aria-label="Increase text size">
          A+
        </button>
        <button type="button" className={cn(btn, step === 0 && 'bg-white/20')} onClick={() => setSize(0)} aria-label="Reset text size" aria-pressed={step === 0}>
          A
        </button>
        <button type="button" className={btn} onClick={() => setSize(Math.max(-1, step - 1) as Step)} disabled={step === -1} aria-label="Decrease text size">
          A-
        </button>
      </div>
      <button type="button" className={cn(btn, 'gap-1 px-2', high && 'bg-white/25')} onClick={toggleContrast} aria-pressed={high}>
        <Contrast className="size-3.5" aria-hidden /> Contrast
      </button>
      <Link href={SCREEN_READER_LINK.href} className="inline-flex items-center gap-1 rounded px-1 text-caption font-medium text-white underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-white">
        <Headphones className="size-3.5" aria-hidden /> Screen Reader Access
      </Link>
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
