import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { env } from '@/server/config/env';

/**
 * The public frame.
 *
 * Deliberately not the portal shell: there is no session here, so there is no
 * sidebar, no notification bell and no persona switcher to render. A citizen
 * checking a permission should not meet a screen that looks like it belongs to
 * somebody who has signed in.
 */
export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-sunk">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-text">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-text">{env.appName}</p>
            <p className="text-caption text-text-muted">Public permission verification</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">{children}</main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto max-w-3xl space-y-1 px-4 py-4 text-caption text-text-muted sm:px-6">
          <p>
            This page confirms whether a building permission exists on the departmental record. It
            shows no internal remarks, no officer details and no fee information.
          </p>
          {env.demoMode && (
            <p className="font-medium text-warning">
              DEMONSTRATION SYSTEM — the records shown here are fabricated for demonstration and
              confirm nothing about any real property.
            </p>
          )}
          <p>
            <Link href="/login" className="text-primary hover:underline">
              Departmental sign-in
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
