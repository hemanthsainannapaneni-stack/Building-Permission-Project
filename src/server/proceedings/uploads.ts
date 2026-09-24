import 'server-only';
import type { NextRequest } from 'next/server';
import { badRequest } from '@/server/http/errors';

/** Reads a multipart body: string fields, and every non-empty `files` part. */
export async function readUploads(req: NextRequest) {
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
  const files: Array<{ name: string; type: string; bytes: Buffer }> = [];
  for (const part of form.getAll('files')) {
    if (part instanceof File && part.size > 0) {
      files.push({ name: part.name, type: part.type, bytes: Buffer.from(await part.arrayBuffer()) });
    }
  }
  if (files.length > 5) throw badRequest('Attach at most five documents.');
  return { field, files };
}
