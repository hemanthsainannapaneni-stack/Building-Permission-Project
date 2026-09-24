import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest, tooLarge } from '@/server/http/errors';
import { respondShowCauseSchema } from '@/lib/schemas/proceedings';
import { respondShowCause } from '@/server/services/show-cause';
import { readUploads } from '@/server/proceedings/uploads';

export const dynamic = 'force-dynamic';

/**
 * The applicant's answer, as MULTIPART: the written response and up to five
 * documents, each through the full upload pipeline.
 */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared && declared > 52 * 1024 * 1024) throw tooLarge('At most five documents of 10 MB each.');
    const { field, files } = await readUploads(req);
    const parsed = respondShowCauseSchema.safeParse({
      response: field('response') ?? '',
      demoDocument: field('demoDocument'),
      expectedStatus: field('expectedStatus'),
    });
    if (!parsed.success) {
      throw badRequest(
        'The response is not complete.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      );
    }
    return respondShowCause(user, params.id, { ...parsed.data, files }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.SHOW_CAUSE_RESPOND], rateLimit: 'upload' }
);
