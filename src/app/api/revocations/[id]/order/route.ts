import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { readRevocationOrder } from '@/server/services/revocations';
import { DOCUMENT_HEADERS } from '@/server/proceedings/documents';

export const dynamic = 'force-dynamic';

/** The generated revocation order, stamped DEMO. */
export const GET = defineRoute(
  async ({ user, params }) => new NextResponse(await readRevocationOrder(user, params.id), { headers: DOCUMENT_HEADERS }),
  { capabilities: [CAPABILITIES.REVOCATION_VIEW] }
);
