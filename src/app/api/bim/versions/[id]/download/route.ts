import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { downloadBimVersion } from '@/server/services/bim';

export const dynamic = 'force-dynamic';

/**
 * Streams one BIM file version back — scoped, scan-checked and audited
 * before a byte moves, exactly as a drawing download is.
 */
export const GET = defineRoute(
  async ({ user, params, ip, userAgent, correlationId }) => {
    const { bytes, file, versionNo, title } = await downloadBimVersion(user, params.id!, {
      ip,
      userAgent,
      correlationId,
    });

    const filename = `${slug(title)}-V${versionNo}-${file.originalName}`;

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  },
  { capabilities: [CAPABILITIES.DRAWING_DOWNLOAD] }
);

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'bim';
