import 'server-only';
import type { NextRequest } from 'next/server';
import { badRequest, tooLarge } from '@/server/http/errors';
import { PROFESSIONAL_DOCUMENTS } from '@/lib/professional-registration';
import type { ProfessionalUploads } from '@/server/services/professional-registrations';

/** Reads a professional registration multipart body: string fields, and documents under `doc_<KIND>`. */
export async function readProfessionalUploads(req: NextRequest) {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared && declared > 85 * 1024 * 1024) throw tooLarge('At most eight files of 10 MB each.');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest('That upload could not be read. Try again.');
  }
  const uploads: ProfessionalUploads = {};
  for (const kind of PROFESSIONAL_DOCUMENTS) {
    const part = form.get(`doc_${kind}`);
    if (part instanceof File && part.size > 0) uploads[kind] = { name: part.name, type: part.type, bytes: Buffer.from(await part.arrayBuffer()) };
  }
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
  return { fields, uploads };
}
