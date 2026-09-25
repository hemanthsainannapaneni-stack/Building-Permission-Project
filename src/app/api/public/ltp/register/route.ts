import { defineRoute } from '@/server/http/route';
import { badRequest, tooLarge } from '@/server/http/errors';
import { professionalDraftSchema } from '@/lib/schemas/professional-registration';
import { readProfessionalUploads } from '@/server/professionals/uploads';
import { filePublicLtpRegistration } from '@/server/public-portal/submissions';

export const dynamic = 'force-dynamic';

/** An LTP registration filed from the public portal — MULTIPART, no session. Never links a portal account. */
export const POST = defineRoute(
  async ({ req, ip, userAgent, correlationId }) => {
    if (Number(req.headers.get('content-length') ?? 0) > 60 * 1024 * 1024) throw tooLarge('At most six files of 10 MB each.');
    const { fields, uploads } = await readProfessionalUploads(req);
    const parsed = professionalDraftSchema.safeParse(fields);
    if (!parsed.success) {
      throw badRequest('The registration details are not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return filePublicLtpRegistration(parsed.data, uploads, { ip, userAgent, correlationId });
  },
  { auth: false, rateLimit: 'publicSubmit' }
);
