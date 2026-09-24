import 'server-only';
import type { NextRequest } from 'next/server';
import { badRequest, tooLarge } from '@/server/http/errors';
import { PROFESSIONAL_CHANGE_DOCUMENTS } from '@/lib/professional-change';
import type { DocumentUploads } from '@/server/services/professional-changes';

/**
 * Reads a change of professional multipart body: string fields, and one file
 * per document kind under `doc_<KIND>` (doc_OWNER_REQUEST_LETTER, …).
 */
export async function readDocumentUploads(req: NextRequest) {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared && declared > 82 * 1024 * 1024) throw tooLarge('At most eight documents of 10 MB each.');
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
  const uploads: DocumentUploads = {};
  for (const kind of PROFESSIONAL_CHANGE_DOCUMENTS) {
    const part = form.get(`doc_${kind}`);
    if (part instanceof File && part.size > 0) {
      uploads[kind] = { name: part.name, type: part.type, bytes: Buffer.from(await part.arrayBuffer()) };
    }
  }
  return { field, uploads };
}
