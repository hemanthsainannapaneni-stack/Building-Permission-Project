import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest, tooLarge } from '@/server/http/errors';
import { issueShowCauseSchema } from '@/lib/schemas/proceedings';
import { issueShowCause } from '@/server/services/show-cause';
import { readUploads } from '@/server/proceedings/uploads';

export const dynamic = 'force-dynamic';

/**
 * Issue a show cause notice, as MULTIPART (supporting documents may travel
 * with it). Performed as the ISSUE_SHOW_CAUSE workflow transition, so the
 * workflow — not this route — decides whether the caller may.
 */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared && declared > 52 * 1024 * 1024) throw tooLarge('At most five documents of 10 MB each.');
    const { field, files } = await readUploads(req);
    const parsed = issueShowCauseSchema.safeParse({
      reason: field('reason') ?? '',
      violation: field('violation') ?? '',
      responseDueDate: field('responseDueDate') ?? '',
      demoDocument: field('demoDocument'),
      expectedSequence: field('expectedSequence') || undefined,
    });
    if (!parsed.success) {
      throw badRequest(
        'The notice is not complete.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      );
    }
    return issueShowCause(user, params.id, { ...parsed.data, files }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.SHOW_CAUSE_ISSUE], rateLimit: 'upload' }
);
