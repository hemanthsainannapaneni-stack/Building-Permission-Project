import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { renderShortfallLetter } from '@/server/services/shortfall-letter';
import { audit } from '@/server/services/audit';
import { prisma } from '@/server/db/prisma';

export const dynamic = 'force-dynamic';

/**
 * The shortfall letter, as a PDF.
 *
 * Row scope is merged into the load inside `renderShortfallLetter`, so a
 * shortfall on somebody else's application is "not found" rather than 403 —
 * the same answer the register and the detail endpoint give, and for the same
 * reason.
 *
 * Printing the letter is an authorization-relevant READ (docs Q.1): it puts
 * the owner's name, the site address and every deficiency into somebody's
 * hands, so it is audited before the bytes leave — the same rule a drawing
 * download and a scrutiny report follow.
 */
export const GET = defineRoute(
  async ({ user, params, ip, userAgent, correlationId }) => {
    const { bytes, filename, model } = await renderShortfallLetter(user, params.id!);

    await audit(prisma, {
      actor: user,
      action: 'SHORTFALL_LETTER_GENERATED',
      entityType: 'Shortfall',
      entityId: model.id,
      applicationId: model.applicationId,
      after: {
        shortfallNumber: model.shortfallNumber,
        applicationNumber: model.application.applicationNumber,
        cycle: model.cycle,
        items: model.items.length,
        isDemo: model.isDemo,
      },
      remarks: `Shortfall letter printed for ${model.shortfallNumber}.`,
      ip,
      userAgent,
      correlationId,
    });

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        // inline: a letter is read before it is filed, and a PDF rendered by
        // the browser's own viewer cannot execute anything against this origin
        // the way a downloaded HTML document could.
        'Content-Disposition': `inline; filename="${filename}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  },
  { capabilities: [CAPABILITIES.SHORTFALL_VIEW] }
);
