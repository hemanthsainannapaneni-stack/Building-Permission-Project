import { defineRoute } from '@/server/http/route';
import { badRequest, tooLarge } from '@/server/http/errors';
import { publicLtpRenewalSchema } from '@/lib/schemas/public-portal';
import { readProfessionalUploads } from '@/server/professionals/uploads';
import { filePublicLtpRenewal } from '@/server/public-portal/submissions';

export const dynamic = 'force-dynamic';

/** An LTP renewal filed from the public portal — MULTIPART (an optional supporting document), no session. */
export const POST = defineRoute(
  async ({ req, ip, userAgent, correlationId }) => {
    if (Number(req.headers.get('content-length') ?? 0) > 20 * 1024 * 1024) throw tooLarge('At most two files of 10 MB each.');
    const { fields, uploads } = await readProfessionalUploads(req);
    const parsed = publicLtpRenewalSchema.safeParse(fields);
    if (!parsed.success) {
      throw badRequest('The renewal details are not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return filePublicLtpRenewal(parsed.data, uploads, { ip, userAgent, correlationId });
  },
  { auth: false, rateLimit: 'publicSubmit' }
);
