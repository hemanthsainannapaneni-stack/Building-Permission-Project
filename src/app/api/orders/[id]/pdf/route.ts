import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { notFound, guardFailed } from '@/server/http/errors';
import { audit } from '@/server/services/audit';
import { ensureApprovalOrderPdf, orderFilename } from '@/server/services/approval-order-pdf';
import { isLtp } from '@/server/auth/context';
import { ORDER_STATUS, orderStatusLabel } from '@/lib/approval-orders';

export const dynamic = 'force-dynamic';

/**
 * The building permission order, as a PDF.
 *
 * ── An applicant sees it only once it is ISSUED ─────────────────────────
 *
 * Officers may read a draft and a preview — that is what those states are for.
 * The applicant may not, and the difference is not cosmetic: a draft carries
 * the same order number and the same particulars as the final, and an
 * applicant holding one has something that looks exactly like a permission
 * and is not one. Scope alone would not catch this, because the order IS on
 * their own application.
 *
 * Downloading is an authorization-relevant read (docs Q.1), so it is audited
 * before the bytes leave — the same rule a drawing and a scrutiny report
 * follow.
 */
export const GET = defineRoute(
  async ({ user, params, ip, userAgent, correlationId }) => {
    const order = await prisma.approvalOrder.findFirst({
      where: {
        id: params.id!,
        application: { deletedAt: null, ...applicationScope(user) },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        applicationId: true,
        application: { select: { applicationNumber: true } },
      },
    });

    if (!order) throw notFound('That approval order could not be found.');

    if (isLtp(user) && order.status !== ORDER_STATUS.ISSUED) {
      throw guardFailed(
        `${order.orderNumber} has not been issued yet. It is currently ${orderStatusLabel(order.status).toLowerCase()}, ` +
          'and you will be told the moment it is released.'
      );
    }

    const bytes = await ensureApprovalOrderPdf(order.id);

    await audit(prisma, {
      actor: user,
      action: 'APPROVAL_ORDER_DOWNLOADED',
      entityType: 'ApprovalOrder',
      entityId: order.id,
      applicationId: order.applicationId,
      after: {
        orderNumber: order.orderNumber,
        status: order.status,
        applicationNumber: order.application.applicationNumber,
      },
      ip,
      userAgent,
      correlationId,
    });

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="${orderFilename(order.orderNumber)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  },
  { capabilities: [CAPABILITIES.ORDER_VIEW] }
);
