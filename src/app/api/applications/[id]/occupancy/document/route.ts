import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { readOccupancyDocument } from '@/server/services/occupancy';

export const dynamic = 'force-dynamic';

/** One document on the current occupancy application: `?index=N`. */
export const GET = defineRoute(
  async ({ user, params, searchParams }) => {
    const index = Math.max(0, Number(searchParams.get('index') ?? 0) || 0);
    const { bytes, mimeType, fileName } = await readOccupancyDocument(user, params.id, index);
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
  { capabilities: [CAPABILITIES.OCCUPANCY_VIEW] }
);
