import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { readProfessionalChangeDocument } from '@/server/services/professional-changes';

export const dynamic = 'force-dynamic';

/** One document on the request: `?index=N`. */
export const GET = defineRoute(
  async ({ user, params, searchParams }) => {
    const index = Math.max(0, Number(searchParams.get('index') ?? 0) || 0);
    const { bytes, mimeType, fileName } = await readProfessionalChangeDocument(user, params.id, index);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="${fileName.replace(/[^\w.-]/g, '_')}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'Cache-Control': 'private, max-age=60',
      },
    });
  },
  { capabilities: [CAPABILITIES.LTP_CHANGE_VIEW] }
);
