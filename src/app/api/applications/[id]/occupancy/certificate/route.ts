import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { readOccupancyCertificate } from '@/server/services/occupancy';

export const dynamic = 'force-dynamic';

/** The occupancy certificate PDF, rendered from its frozen snapshot. */
export const GET = defineRoute(
  async ({ user, params, ip, userAgent, correlationId }) => {
    const { bytes, fileName } = await readOccupancyCertificate(user, params.id, { ip, userAgent, correlationId });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="${fileName}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  },
  { capabilities: [CAPABILITIES.OCCUPANCY_VIEW] }
);
