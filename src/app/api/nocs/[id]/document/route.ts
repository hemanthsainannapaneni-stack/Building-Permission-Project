import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { readNocDocument } from '@/server/services/nocs';

export const dynamic = 'force-dynamic';

/**
 * The attached certificate, inline. A demo NOC with no file comes back as a
 * labelled SVG placeholder generated here, stamped DEMO.
 */
export const GET = defineRoute(
  async ({ user, params }) => {
    const { bytes, mimeType, fileName } = await readNocDocument(user, params.id!);
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
  { capabilities: [CAPABILITIES.NOC_VIEW] }
);
