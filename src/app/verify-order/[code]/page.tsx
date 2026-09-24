import type { Metadata } from 'next';
import { VerifyForm } from '@/features/public/verify-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verify a building permission',
  robots: { index: false, follow: false },
};

/**
 * The link printed on every order.
 *
 * The code goes straight into the form and the lookup runs on arrival —
 * somebody who followed a link from a document has already asked their
 * question. The page is otherwise identical to the search page, so a person
 * who arrives this way can also check a second reference without navigating.
 */
export default async function VerifyByCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-h2 font-semibold text-text">Verify a building permission</h1>
        <p className="mt-1 text-small text-text-muted">
          Checking the reference printed on the document you followed.
        </p>
      </div>

      <VerifyForm initialReference={code} />
    </div>
  );
}
