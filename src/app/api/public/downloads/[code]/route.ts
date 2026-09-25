import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { notFound } from '@/server/http/errors';
import { buildDownload } from '@/server/public-portal/downloads';

export const dynamic = 'force-dynamic';

/** One public download, by catalogue slug (the `[code]` segment). Anything not in the catalogue is a 404 — the slug never reaches the filesystem. */
export const GET = defineRoute(
  async ({ params }) => {
    const built = await buildDownload(params.code ?? '');
    if (!built) throw notFound('That document is not available.');
    return new NextResponse(new Uint8Array(built.body), {
      headers: {
        'Content-Type': built.contentType,
        'Content-Disposition': `attachment; filename="${built.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
  { auth: false, rateLimit: 'publicBrowse' }
);
