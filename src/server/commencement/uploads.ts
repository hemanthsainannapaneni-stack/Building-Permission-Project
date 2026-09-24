import 'server-only';
import type { NextRequest } from 'next/server';
import { badRequest, tooLarge } from '@/server/http/errors';
import { COMMENCEMENT_DOCUMENTS } from '@/lib/commencement';
import type { CommencementUploads } from '@/server/services/work-commencements';

/** Reads a commencement multipart body: string fields, and one file per kind under `doc_<KIND>`. */
export async function readCommencementUploads(req: NextRequest) {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared && declared > 32 * 1024 * 1024) throw tooLarge('At most three documents of 10 MB each.');
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
  const uploads: CommencementUploads = {};
  for (const kind of COMMENCEMENT_DOCUMENTS) {
    const part = form.get(`doc_${kind}`);
    if (part instanceof File && part.size > 0) {
      uploads[kind] = { name: part.name, type: part.type, bytes: Buffer.from(await part.arrayBuffer()) };
    }
  }
  return { field, uploads };
}
