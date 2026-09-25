import { defineRoute } from '@/server/http/route';
import { badRequest, tooLarge } from '@/server/http/errors';
import { developerDraftSchema } from '@/lib/schemas/developer-registration';
import { readDeveloperUploads } from '@/server/developers/uploads';
import { filePublicDeveloperRegistration } from '@/server/public-portal/submissions';

export const dynamic = 'force-dynamic';

/**
 * A developer registration filed from the public portal — MULTIPART, no session.
 *
 * Opens and submits in one call, through the same service the inward desk
 * uses (see `src/server/public-portal/submissions.ts`). Rate limited by
 * address: it writes rows and stores files for a caller with no account.
 */
export const POST = defineRoute(
  async ({ req, ip, userAgent, correlationId }) => {
    if (Number(req.headers.get('content-length') ?? 0) > 60 * 1024 * 1024) throw tooLarge('At most six files of 10 MB each.');
    const { fields, uploads } = await readDeveloperUploads(req);
    const parsed = developerDraftSchema.safeParse(fields);
    if (!parsed.success) {
      throw badRequest('The registration details are not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return filePublicDeveloperRegistration(parsed.data, uploads, { ip, userAgent, correlationId });
  },
  { auth: false, rateLimit: 'publicSubmit' }
);
