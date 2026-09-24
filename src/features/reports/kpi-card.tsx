import * as React from 'react';

interface KpiCardProps {
  title: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string; size?: number | string }>;
  hint?: string;
}

export function KpiCard({ title, value, icon: Icon, hint }: KpiCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <div className="relative z-10 flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-slate-500">
              {title}
            </p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 xl:text-[28px]">
              {value}
            </p>
          </div>

          {Icon && (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 p-1">
              <Icon className="size-5" />
            </div>
          )}
        </div>

        {hint && (
          <div className="mt-3.5">
            <span className="truncate text-xs text-slate-400">
              {hint}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
