import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { readOccupancyPhoto } from '@/server/services/occupancy';

export const dynamic = 'force-dynamic';

/** One final-inspection photograph: `?round=N&index=M`. */
export const GET = defineRoute(
  async ({ user, params, searchParams }) => {
    const round = Math.max(1, Number(searchParams.get('round') ?? 1) || 1);
    const index = Math.max(0, Number(searchParams.get('index') ?? 0) || 0);
    const { bytes, mimeType, fileName } = await readOccupancyPhoto(user, params.id, round, index);
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
