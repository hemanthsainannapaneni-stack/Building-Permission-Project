import 'server-only';
import type { NextRequest } from 'next/server';
import { badRequest, tooLarge } from '@/server/http/errors';
import { OCCUPANCY_DOCUMENTS, OCCUPANCY_PHOTO_VIEWS } from '@/lib/occupancy';
import type { OccupancyUploads } from '@/server/services/occupancy';

/**
 * Reads an occupancy multipart body: string fields, documents under
 * `doc_<KIND>` and inspection photographs under `photo_<VIEW>`.
 */
export async function readOccupancyUploads(req: NextRequest) {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared && declared > 125 * 1024 * 1024) throw tooLarge('At most twelve files of 10 MB each.');
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
  const uploads: OccupancyUploads = { documents: {}, photos: {} };
  const read = async (key: string) => {
    const part = form.get(key);
    return part instanceof File && part.size > 0 ? { name: part.name, type: part.type, bytes: Buffer.from(await part.arrayBuffer()) } : undefined;
  };
  for (const kind of OCCUPANCY_DOCUMENTS) {
    const f = await read(`doc_${kind}`);
    if (f) uploads.documents[kind] = f;
  }
  for (const view of OCCUPANCY_PHOTO_VIEWS) {
    const f = await read(`photo_${view}`);
    if (f) uploads.photos[view] = f;
  }
  return { field, uploads };
}
