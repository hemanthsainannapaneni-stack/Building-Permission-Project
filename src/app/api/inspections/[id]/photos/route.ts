import { defineRoute, created } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest, tooLarge } from '@/server/http/errors';
import { MAX_PHOTO_BYTES } from '@/lib/site-inspection';
import { photoMetadataSchema } from '@/lib/schemas/site-inspections';
import { addInspectionPhoto } from '@/server/services/site-inspections';

export const dynamic = 'force-dynamic';

/**
 * A geo-tagged photograph, as MULTIPART: the image plus its category, DEMO
 * coordinates, capture time and description.
 *
 * The file is optional. Without one the row is a clearly-labelled demo
 * placeholder, so the flow can be demonstrated without a camera; with one it
 * goes through the full upload pipeline (size, extension, magic bytes, scan).
 */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared && declared > MAX_PHOTO_BYTES * 1.05) {
      throw tooLarge(`A photograph may be at most ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} MB.`);
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw badRequest('That upload could not be read. Try again.');
    }

    const parsed = photoMetadataSchema.safeParse({
      category: form.get('category'),
      latitude: form.get('latitude'),
      longitude: form.get('longitude'),
      capturedAt: form.get('capturedAt'),
      description: form.get('description') ?? '',
    });
    if (!parsed.success) {
      throw badRequest(
        'Some of the photograph details are not valid.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      );
    }

    const file = form.get('file');
    const upload =
      file instanceof File && file.size > 0
        ? { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }
        : null;

    return created(
      await addInspectionPhoto(user, params.id!, { ...parsed.data, file: upload }, { ip, userAgent, correlationId })
    );
  },
  { capabilities: [CAPABILITIES.SITE_INSPECTION_CONDUCT], rateLimit: 'inspectionPhoto' }
);
