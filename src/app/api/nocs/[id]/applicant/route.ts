import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest, tooLarge } from '@/server/http/errors';
import { applicantUpdateSchema } from '@/lib/schemas/nocs';
import { applicantUpdate } from '@/server/services/nocs';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * The applicant's record, as MULTIPART: what they applied for with the
 * authority, or the certificate that came back — with the certificate itself
 * attached, through the full upload pipeline (size, extension, magic bytes).
 */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared && declared > MAX_BYTES * 1.05) throw tooLarge('A NOC certificate may be at most 10 MB.');

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw badRequest('That upload could not be read. Try again.');
    }

    const field = (k: string) => {
      const v = form.get(k);
      return typeof v === 'string' ? v : undefined;
    };
    const parsed = applicantUpdateSchema.safeParse({
      action: field('action'),
      authority: field('authority'),
      applicationReference: field('applicationReference'),
      appliedDate: field('appliedDate'),
      referenceNumber: field('referenceNumber'),
      issuedDate: field('issuedDate'),
      expiryDate: field('expiryDate'),
      remarks: field('remarks') ?? '',
      demoDocument: field('demoDocument'),
      expectedStatus: field('expectedStatus'),
    });
    if (!parsed.success) {
      throw badRequest(
        'Some of the NOC details are not valid.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      );
    }

    const file = form.get('file');
    const upload =
      file instanceof File && file.size > 0
        ? { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }
        : null;

    return applicantUpdate(user, params.id!, { ...parsed.data, file: upload }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.NOC_UPDATE], rateLimit: 'upload' }
);
