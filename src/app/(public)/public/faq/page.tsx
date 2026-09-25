import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { FAQ_ITEMS } from '@/lib/public-content';
import { PageFrame } from '@/features/public-portal/primitives';

export const metadata: Metadata = { title: 'FAQ' };

export default function FaqPage() {
  return (
    <PageFrame title="Frequently Asked Questions" intro="Answers about how this demonstration portal works. Nothing here states a legal requirement, a fee or a time limit." demo>
      <div className="space-y-3">
        {FAQ_ITEMS.map((item) => (
          <details key={item.id} id={item.id} className="group rounded-xl border border-border bg-surface shadow-card open:shadow-card-hover">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 text-lg font-semibold text-text marker:hidden focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronDown className="size-5 shrink-0 text-text-muted transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="space-y-3 border-t border-border/70 px-5 py-4 text-body text-text-muted">
              {item.answer.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {item.href && (
                <p>
                  <Link href={item.href} className="font-medium text-primary hover:underline">
                    {item.hrefLabel ?? 'Open'} →
                  </Link>
                </p>
              )}
            </div>
          </details>
        ))}
      </div>
    </PageFrame>
  );
}
