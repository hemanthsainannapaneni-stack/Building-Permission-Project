import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { readOutwardDocument } from '@/server/services/outward';
import { DOCUMENT_HEADERS } from '@/server/proceedings/documents';

export const dynamic = 'force-dynamic';

/** Preview: the generated notice or order, or a dispatch slip for anything else. */
export const GET = defineRoute(
  async ({ user, params }) => new NextResponse(await readOutwardDocument(user, params.id), { headers: DOCUMENT_HEADERS }),
  { capabilities: [CAPABILITIES.OUTWARD_VIEW] }
);
