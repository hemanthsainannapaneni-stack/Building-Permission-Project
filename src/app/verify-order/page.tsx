import type { Metadata } from 'next';
import { VerifyForm } from '@/features/public/verify-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verify a building permission',
  // A verification page is not a page search engines should rank against
  // property addresses, and the records behind it are looked up one at a time
  // by people who already hold a reference.
  robots: { index: false, follow: false },
};

export default function VerifyPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-h2 font-semibold text-text">Verify a building permission</h1>
        <p className="mt-1 text-small text-text-muted">
          Enter the application number or the proceeding number exactly as it appears on the
          document you are holding.
        </p>
      </div>

      <VerifyForm />
    </div>
  );
}
