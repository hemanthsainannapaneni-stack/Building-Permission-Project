'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type FieldValues, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Check, ChevronLeft, ChevronRight, Save, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { WIZARD_REQUIRES_FIELDS_TO_ADVANCE, WIZARD_STEPS, stepAt, type StepKey } from '@/lib/application-steps';
import { STEP_SCHEMAS, isDataStepKey, type DataStepKey } from '@/lib/schemas/applications';
import { api, ApiCallError } from '../api';
import type { ApplicationMeta, WizardState } from '../types';
import { StepFields } from './step-fields';
import { ReviewStep } from './review-step';
import { SubmitStep } from './submit-step';

/**
 * The filing wizard.
 *
 * ── What makes this resumable ──────────────────────────────────────────
 *
 * Nothing is held only in the browser. Pressing Next validates the step and
 * writes it to the real tables; Save draft writes the unvalidated values to
 * `application_drafts.scratch`. Either way the state that matters is on the
 * server before the button stops spinning, so closing the laptop mid-form
 * loses nothing and the wizard reopens exactly where it was left.
 *
 * ── Why each step remounts ─────────────────────────────────────────────
 *
 * `key={stepKey}` on the form. Steps have different fields and different
 * schemas, and reusing one form instance across them leaves stale values and
 * stale errors behind — a validation message from step 3 surviving into step 4
 * is the classic wizard bug.
 *
 * ── Where validation lives ─────────────────────────────────────────────
 *
 * In the schemas, used by the resolver here and again by the route on the
 * server. The client copy is a courtesy that saves a round trip; the server
 * copy is the one that decides. A field error the server returns is attached
 * back onto the form, so a rule that only the server can check still lands on
 * the right input.
 */

const AUTOSAVE_MS = 20_000;

/**
 * The step's Zod schema, as a resolver this one generic form can accept.
 *
 * The eight step schemas have eight different output types, so their union is
 * assignable to no single `Resolver<T>` — which is exactly the situation a
 * wizard creates and TypeScript cannot express without either eight separate
 * form components or a cast.
 *
 * The cast is contained to this function, and it is safe in the direction that
 * matters: the schema still validates at runtime, and the SERVER re-parses the
 * same schema before writing anything. Widening the form's static type cannot
 * let bad data through — it only stops the compiler from knowing which of the
 * eight shapes is in play on any given render.
 */
function stepResolver(stepKey: DataStepKey): Resolver<FieldValues> {
  // Widened to ZodTypeAny first: the union of eight schemas matches none of
  // zodResolver's overloads, though every member of it individually does.
  const schema: z.ZodTypeAny = STEP_SCHEMAS[stepKey];
  return zodResolver(schema) as unknown as Resolver<FieldValues>;
}

export function ApplicationWizard({
  initial,
  meta,
}: {
  initial: WizardState;
  meta: ApplicationMeta;
}) {
  const router = useRouter();
  const [state, setState] = React.useState(initial);
  const [index, setIndex] = React.useState(() =>
    Math.min(Math.max(initial.draft.currentStep, 0), WIZARD_STEPS.length - 1)
  );
  const [busy, setBusy] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const step = stepAt(index)!;
  const application = state.application;

  const goTo = React.useCallback((next: number) => {
    setFormError(null);
    setIndex(Math.min(Math.max(next, 0), WIZARD_STEPS.length - 1));
    // The step heading is the new top of the page; leaving the scroll where it
    // was makes a long step look like nothing happened.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <Progress
        index={index}
        completion={state.completion}
        completedSteps={state.draft.completedSteps}
        onJump={goTo}
      />

      <div className="min-w-0 space-y-4">
        <SaveIndicator savedAt={savedAt} busy={busy} />

        {step.key === 'review' ? (
          <ReviewStep
            state={state}
            meta={meta}
            onEditStep={(key) => goTo(WIZARD_STEPS.findIndex((s) => s.key === key))}
            onBack={() => goTo(index - 1)}
            onNext={() => goTo(index + 1)}
          />
        ) : step.key === 'submit' ? (
          <SubmitStep
            state={state}
            onBack={() => goTo(index - 1)}
            onSubmitted={(app) => {
              toast.success('Application filed', {
                description: `${app.applicationNumber} has been submitted for review.`,
              });
              router.push(`/applications/${app.id}?filed=1`);
              router.refresh();
            }}
          />
        ) : isDataStepKey(step.key) ? (
          <StepForm
            // Remounts on every step change — see the note above.
            key={step.key}
            stepKey={step.key}
            applicationId={application.id}
            state={state}
            meta={meta}
            index={index}
            busy={busy}
            setBusy={setBusy}
            formError={formError}
            setFormError={setFormError}
            onSaved={(next, at) => {
              setState(next);
              if (at) setSavedAt(at);
            }}
            onAdvance={() => goTo(index + 1)}
            onBack={() => goTo(index - 1)}
          />
        ) : null}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// One step
// ═══════════════════════════════════════════════════════════════════════════

function StepForm({
  stepKey,
  applicationId,
  state,
  meta,
  index,
  busy,
  setBusy,
  formError,
  setFormError,
  onSaved,
  onAdvance,
  onBack,
}: {
  stepKey: DataStepKey;
  applicationId: string;
  state: WizardState;
  meta: ApplicationMeta;
  index: number;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  formError: string | null;
  setFormError: (error: string | null) => void;
  onSaved: (state: WizardState, savedAt?: Date) => void;
  onAdvance: () => void;
  onBack: () => void;
}) {
  const step = WIZARD_STEPS[index]!;

  /**
   * Persisted values first, then anything left in scratch on top.
   *
   * Scratch wins because it is by definition NEWER: it only exists when the
   * user typed something and saved a draft without the step validating. If it
   * lost to the persisted row, "Save draft" would appear to discard work.
   */
  const defaultValues = React.useMemo(() => {
    const persisted = state.steps[stepKey] ?? {};
    const scratch = (state.draft.scratch?.[stepKey] as Record<string, unknown> | undefined) ?? {};
    return { ...persisted, ...scratch } as FieldValues;
  }, [state.steps, state.draft.scratch, stepKey]);

  const form = useForm<FieldValues>({
    resolver: stepResolver(stepKey),
    defaultValues,
    // Errors appear when a field is left, not on every keystroke — validating
    // as someone types tells them a half-entered phone number is wrong before
    // they have finished entering it.
    mode: 'onBlur',
  });

  const save = React.useCallback(
    async (data: FieldValues, partial: boolean, quiet = false) => {
      setBusy(true);
      setFormError(null);
      try {
        const next = await api.patch<WizardState>(`/api/applications/${applicationId}`, {
          step: stepKey,
          data,
          partial,
        });
        onSaved(next, new Date());
        return next;
      } catch (error) {
        // A quiet attempt reports nothing: the caller falls back to a draft.
        if (quiet) return null;
        if (error instanceof ApiCallError) {
          // Field errors from the server land on the inputs they belong to,
          // so a server-only rule still reads like ordinary validation.
          for (const [path, message] of Object.entries(error.fieldErrors())) {
            form.setError(path as never, { type: 'server', message });
          }
          setFormError(error.details.length ? null : error.message);
          if (error.details.length) {
            toast.error('Some details need attention', { description: error.message });
          }
        } else {
          setFormError('Something went wrong. Try again.');
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [applicationId, stepKey, form, onSaved, setBusy, setFormError]
  );

  /**
   * Periodic draft save while the user is still typing.
   *
   * Unvalidated on purpose — an autosave that refused half-finished input
   * would be an autosave that never fires. It writes to scratch, so nothing
   * partial reaches the register.
   */
  React.useEffect(() => {
    const timer = setInterval(() => {
      if (!form.formState.isDirty || busy) return;
      void save(form.getValues(), true);
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [form, save, busy]);

  const enforced = form.handleSubmit(async (data) => {
    const next = await save(data, false);
    if (next) onAdvance();
  });

  /**
   * See WIZARD_REQUIRES_FIELDS_TO_ADVANCE. The step is saved for real when the
   * server accepts it; otherwise what was typed is kept as a draft. Either
   * way the user moves on.
   */
  const relaxed = async (event?: React.BaseSyntheticEvent) => {
    event?.preventDefault();
    const data = form.getValues();
    const next = (await save(data, false, true)) ?? (await save(data, true));
    if (next) onAdvance();
  };

  const onNext = WIZARD_REQUIRES_FIELDS_TO_ADVANCE ? enforced : relaxed;

  const onSaveDraft = async () => {
    // No validation: the point of Save draft is that it always works.
    const next = await save(form.getValues(), true);
    if (next) toast.success('Draft saved', { description: 'You can close this and come back to it.' });
  };

  return (
    <Card>
      <CardHeader>
        <p className="text-caption font-medium uppercase tracking-wide text-text-muted">
          Step {index + 1} of {WIZARD_STEPS.length}
        </p>
        <CardTitle className="mt-1">{step.label}</CardTitle>
        <CardDescription>{step.description}</CardDescription>
      </CardHeader>

      <form onSubmit={onNext} noValidate>
        <CardContent className="space-y-5">
          {formError && (
            <p
              role="alert"
              className="rounded border border-danger/30 bg-danger-bg px-3 py-2 text-small text-danger"
            >
              {formError}
            </p>
          )}

          <StepFields
            stepKey={stepKey}
            form={form}
            meta={meta}
            applicantName={(state.steps.applicant?.name as string) ?? ''}
          />
        </CardContent>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={onBack} disabled={index === 0 || busy}>
            <ChevronLeft className="size-4" />
            Previous
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onSaveDraft} disabled={busy}>
              <Save className="size-4" />
              Save draft
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Progress
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The step list.
 *
 * A step is shown complete when its data ACTUALLY validates — `completion`
 * comes from the server re-reading the persisted rows, not from a local tally
 * of which Next buttons were pressed. So a step that was completed and later
 * emptied stops showing a tick, which is the honest thing for a checklist to
 * do.
 *
 * Every visited step is reachable by clicking, because forcing someone to
 * press Previous six times to fix a typo is hostile.
 */
function Progress({
  index,
  completion,
  completedSteps,
  onJump,
}: {
  index: number;
  completion: Record<string, boolean>;
  completedSteps: string[];
  onJump: (index: number) => void;
}) {
  const done = WIZARD_STEPS.filter((s) => s.capturesData && completion[s.key]).length;
  const total = WIZARD_STEPS.filter((s) => s.capturesData).length;

  return (
    <nav aria-label="Application steps" className="lg:sticky lg:top-4 lg:self-start">
      <div className="mb-3">
        <div className="flex items-baseline justify-between">
          <p className="text-caption font-medium uppercase tracking-wide text-text-muted">Progress</p>
          <p className="text-caption tabular-nums text-text-muted">
            {done}/{total}
          </p>
        </div>
        <div
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-sunk"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`${done} of ${total} steps complete`}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      <ol className="space-y-0.5">
        {WIZARD_STEPS.map((step, i) => {
          const complete = step.capturesData && completion[step.key];
          const current = i === index;
          // Reachable once visited, or once everything before it is done.
          const visited = completedSteps.includes(step.key) || i <= index;

          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={() => onJump(i)}
                disabled={!visited}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-small transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  current
                    ? 'bg-primary-subtle font-medium text-primary'
                    : visited
                      ? 'text-text-muted hover:bg-surface-sunk hover:text-text'
                      : 'cursor-not-allowed text-text-subtle'
                )}
              >
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums',
                    complete
                      ? 'border-success bg-success text-white'
                      : current
                        ? 'border-primary text-primary'
                        : 'border-border-strong text-text-subtle'
                  )}
                  aria-hidden
                >
                  {complete ? <Check className="size-3" /> : i + 1}
                </span>
                <span className="min-w-0 truncate">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Tells the user their work is safe, without stealing attention. */
function SaveIndicator({ savedAt, busy }: { savedAt: Date | null; busy: boolean }) {
  if (busy) {
    return (
      <p className="flex items-center gap-1.5 text-caption text-text-muted" aria-live="polite">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Saving…
      </p>
    );
  }

  if (!savedAt) {
    return (
      <p className="flex items-center gap-1.5 text-caption text-text-subtle">
        <AlertTriangle className="size-3" aria-hidden />
        Your work is saved to the server on Next, and every 20 seconds.
      </p>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-caption text-success" aria-live="polite">
      <Check className="size-3" aria-hidden />
      Saved at{' '}
      {savedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </p>
  );
}

export type { StepKey };
