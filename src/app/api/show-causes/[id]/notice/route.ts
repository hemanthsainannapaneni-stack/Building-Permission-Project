import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { readShowCauseNotice } from '@/server/services/show-cause';
import { DOCUMENT_HEADERS } from '@/server/proceedings/documents';

export const dynamic = 'force-dynamic';

/** The generated notice, stamped DEMO. */
export const GET = defineRoute(
  async ({ user, params }) => new NextResponse(await readShowCauseNotice(user, params.id), { headers: DOCUMENT_HEADERS }),
  { capabilities: [CAPABILITIES.SHOW_CAUSE_VIEW] }
);
