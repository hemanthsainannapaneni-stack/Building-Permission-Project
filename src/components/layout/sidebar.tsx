'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { visibleNav } from '@/lib/navigation';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Capability-filtered navigation.
 *
 * Items belonging to a later phase are shown but disabled, with the phase
 * named — an officer who can see "Tasks · Phase 7" understands the system is
 * incomplete, whereas a link that 404s reads as broken.
 */
export function Sidebar({
  capabilities,
  collapsed,
  onNavigate,
}: {
  capabilities: string[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = React.useMemo(() => visibleNav(capabilities), [capabilities]);

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex h-full flex-col bg-gradient-to-b from-[#0f172a] via-[#1e1b4b] to-[#042f2e] text-white shadow-xl',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className={cn('flex h-16 items-center gap-3 border-b border-white/20 px-4', collapsed && 'justify-center px-0')}>
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-[#0f172a] shadow-sm overflow-hidden">
          <img src="/logo.jpg" alt="Nirman Logo" className="size-full object-cover" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-h2 font-bold tracking-tight text-white">Nirman</span>
              <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                AP
              </span>
            </div>
            <p className="truncate text-caption text-white/70">Building Permission Authority</p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, i) => (
          <div key={section.label ?? i} className={cn(i > 0 && 'mt-6')}>
            {section.label && !collapsed && (
              <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-white/60">
                {section.label}
              </p>
            )}

            <ul className="space-y-1">
              {section.items.map((item) => {
                const active =
                  pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
                const Icon = item.icon;
                const disabled = Boolean(item.comingIn);

                const inner = (
                  <>
                    <Icon className={cn('size-4 shrink-0 transition-colors', active ? 'text-white' : 'text-white/70')} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && disabled && (
                      <span className="ml-auto shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60">
                        {item.comingIn}
                      </span>
                    )}
                  </>
                );

                const classes = cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2 text-small font-medium transition-all duration-150',
                  collapsed && 'justify-center px-0 py-2.5',
                  disabled
                    ? 'cursor-not-allowed text-white/40'
                    : active
                      ? 'bg-white/20 font-semibold text-white shadow-sm'
                      : 'text-white/80 hover:bg-white/10 hover:text-white'
                );

                const node = disabled ? (
                  <span className={classes} aria-disabled>
                    {inner}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(classes, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary')}
                  >
                    {inner}
                  </Link>
                );

                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{node}</TooltipTrigger>
                        <TooltipContent side="right" className="font-medium">
                          {item.label}
                          {item.comingIn ? ` · ${item.comingIn}` : ''}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      node
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
