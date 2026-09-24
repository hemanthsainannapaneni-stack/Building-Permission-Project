'use client';

import * as React from 'react';
import { UserCheck, Sparkles, Check, ChevronDown, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * Switch Desk.
 *
 * The list used to be a hard-coded array of six people in this file — names,
 * emails, descriptions and the demo password, all string literals in the
 * client bundle. It had drifted from the product: it offered a Commissioner
 * and no ZDD, and no Planning Officer at all, which is the wrong shape for the
 * chain the system now runs.
 *
 * It now comes from `/api/auth/desks`, which reads the accounts the seed
 * actually created and returns them in the order the approval chain visits
 * them. Adding a desk is a seed change; this file does not know the names of
 * any role.
 *
 * Switching SIGNS IN as that account, through the ordinary sign-in route. It
 * does not impersonate and it does not widen anything: the session that
 * results carries exactly the capabilities that account holds. Outside
 * DEMO_MODE the endpoint returns nothing and this control renders nothing.
 */

type Desk = {
  email: string;
  name: string;
  roleKey: string;
  roleName: string;
  designation: string;
  purpose: string;
  group: string;
  zones: string[];
};

/** Group → the tone its initial badge is painted in. */
const GROUP_TONE: Record<string, string> = {
  Applicant: 'text-blue-600 bg-blue-50 border-blue-200',
  Department: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  Administration: 'text-purple-600 bg-purple-50 border-purple-200',
};

export function QuickPersonaSwitcher({ currentEmail }: { currentEmail: string }) {
  const [desks, setDesks] = React.useState<Desk[] | null>(null);
  const [password, setPassword] = React.useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = React.useState<string | null>(null);

  // Fetched once, on mount. The list changes only when the seed runs.
  React.useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/desks')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        const data = (body.data ?? body) as { desks?: Desk[]; password?: string | null };
        setDesks(data.desks ?? []);
        setPassword(data.password ?? null);
      })
      .catch(() => {
        if (!cancelled) setDesks([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function switchDesk(email: string) {
    if (email === currentEmail || switchingTo || !password) return;
    setSwitchingTo(email);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) throw new Error('Failed to switch desk');

      toast.success('Switched desk', { description: `Now active on ${email}` });

      // Reload so every server layout and session cache is rebuilt.
      window.location.href = '/dashboard';
    } catch {
      setSwitchingTo(null);
      toast.error('Could not switch desk', {
        description: 'Check your connection and try again.',
      });
    }
  }

  // Nothing to switch to — DEMO_MODE is off, or the list has not arrived yet.
  if (!desks?.length) return null;

  const active = desks.find((d) => d.email === currentEmail);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-caption font-medium text-primary',
            'transition-all duration-150 hover:bg-primary/10 hover:border-primary/30 active:scale-[0.98]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          )}
          aria-label="Switch officer desk"
        >
          {switchingTo ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5 text-primary" />
          )}
          <span className="hidden sm:inline font-semibold">
            {active ? active.roleName : 'Switch Desk'}
          </span>
          <ChevronDown className="size-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-2 shadow-elevated rounded-xl">
        <DropdownMenuLabel className="px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 text-text">
            <UserCheck className="size-4 text-primary" />
            <span className="font-semibold text-small">Department Officer Desk</span>
          </div>
          <p className="mt-0.5 text-caption font-normal text-text-muted">
            Switch officer station or applicant portal view
          </p>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="my-1.5" />

        <div className="space-y-1">
          {desks.map((desk) => {
            const isCurrent = desk.email === currentEmail;
            const isSwitching = switchingTo === desk.email;

            return (
              <DropdownMenuItem
                key={desk.email}
                disabled={isCurrent || Boolean(switchingTo)}
                onSelect={(e) => {
                  e.preventDefault();
                  void switchDesk(desk.email);
                }}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg p-2 transition-colors cursor-pointer',
                  isCurrent && 'bg-primary-subtle/50 cursor-default'
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border text-caption font-bold',
                    GROUP_TONE[desk.group] ?? 'text-slate-600 bg-slate-50 border-slate-200'
                  )}
                >
                  {isSwitching ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : isCurrent ? (
                    <Check className="size-3.5 text-primary" />
                  ) : (
                    desk.group.charAt(0)
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className="truncate text-small font-semibold text-text leading-tight">
                      {desk.name}
                      <span className="font-normal text-text-muted"> · {desk.roleName}</span>
                    </p>
                    <span className="shrink-0 rounded-full bg-surface-sunk px-1.5 py-0.2 text-[10px] font-medium text-text-muted">
                      {desk.group}
                    </span>
                  </div>
                  <p className="text-caption text-text-muted leading-tight mt-0.5">
                    {desk.purpose}
                    {desk.zones.length > 0 && ` · ${desk.zones.join(', ')}`}
                  </p>
                </div>
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
