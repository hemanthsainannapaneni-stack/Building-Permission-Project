import { defineRoute, created } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest, tooLarge } from '@/server/http/errors';
import { env } from '@/server/config/env';
import { uploadBimFile } from '@/server/services/bim';

export const dynamic = 'force-dynamic';

/**
 * Uploads a BIM deliverable — an IFC model, BCF clash set, COBie workbook or
 * BIM Execution Plan — as a new deliverable or the next version of one.
 *
 * Multipart, like the drawings upload, and through the same file pipeline:
 * size, extension, declared type, magic bytes, checksum, scan.
 */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const declaredLength = Number(req.headers.get('content-length') ?? 0);
    if (declaredLength && declaredLength > env.maxUploadBytes * 1.05) {
      throw tooLarge(
        `That upload is larger than the ${Math.round(env.maxUploadBytes / (1024 * 1024))} MB limit.`
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw badRequest('That upload could not be read. Try again.');
    }

    const file = form.get('file');
    if (!(file instanceof File)) throw badRequest('Choose a file to upload.');

    return created(
      await uploadBimFile(
        user,
        {
          applicationId: params.id!,
          kind: String(form.get('kind') ?? 'IFC_MODEL'),
          discipline: String(form.get('discipline') ?? ''),
          title: String(form.get('title') ?? ''),
          remarks: String(form.get('remarks') ?? ''),
          bimModelId: form.get('bimModelId') ? String(form.get('bimModelId')) : undefined,
          file: { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
        },
        { ip, userAgent, correlationId }
      )
    );
  },
  { capabilities: [CAPABILITIES.DRAWING_UPLOAD], rateLimit: 'upload' }
);
