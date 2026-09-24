import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { readInspectionPhoto } from '@/server/services/site-inspections';

export const dynamic = 'force-dynamic';

/**
 * Streams one inspection photograph, inline, to a caller who may see the
 * application. A seeded demo photograph with no file comes back as a labelled
 * SVG placeholder generated here — never as anything the applicant supplied.
 */
export const GET = defineRoute(
  async ({ user, params }) => {
    const { bytes, mimeType } = await readInspectionPhoto(user, params.photoId!);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        // The placeholder is our own markup; still, nothing it contains may run.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'Cache-Control': 'private, max-age=300',
      },
    });
  },
  { capabilities: [CAPABILITIES.SITE_INSPECTION_VIEW] }
);
