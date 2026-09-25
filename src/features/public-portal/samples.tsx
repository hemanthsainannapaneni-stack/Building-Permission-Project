import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import type { SampleApplication } from '@/server/public-portal/samples';

/** Demo-mode only: real (fictional) references to try, so a demonstration does not stall on "what do I type?". */
export function SampleApplications({ items, path }: { items: SampleApplication[]; path: '/public/status' | '/public/pay-fees' }) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-dashed border-warning/50 bg-warning-bg/50 px-4 py-3">
      <p className="flex items-center gap-2 text-small font-semibold text-text">
        <FlaskConical className="size-4 text-warning" aria-hidden /> Demo applications you can try
      </p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {items.map((s) => (
          <li key={s.applicationNumber} className="text-small">
            <Link href={`${path}?ref=${encodeURIComponent(s.applicationNumber)}&mobile=${encodeURIComponent(s.mobileHint)}`} className="font-mono font-medium text-primary hover:underline">
              {s.applicationNumber}
            </Link>
            <span className="block text-text-muted">
              {s.permissionType} · {s.statusHint} · mobile ends {s.mobileHint}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
