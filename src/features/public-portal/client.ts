'use client';

import { ApiCallError } from '@/features/applications/api';

/**
 * The public forms' fetch wrapper.
 *
 * Same failure shape the workspace uses (`ApiCallError`: a sentence, field
 * errors pathed as the server sent them, and offline told apart from a server
 * refusal) — but nothing here redirects on 401 or raises a toast, because the
 * public pages have neither a session to lose nor a toaster mounted. Errors are
 * returned to the form, which prints them in place with `role="alert"`.
 */
export async function postPublic<T>(url: string, body: FormData | Record<string, unknown>): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      body: isForm ? (body as FormData) : JSON.stringify(body),
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    });
  } catch {
    throw new ApiCallError('Could not reach the server. Check your connection and try again.', { offline: true });
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string; code?: string; details?: { path: string; message: string }[] }) | null;
  if (!res.ok) {
    if (res.status === 429) throw new ApiCallError('Too many attempts from this connection. Please wait a little and try again.', { status: 429, code: 'RATE_LIMITED' });
    throw new ApiCallError(json?.error ?? 'That did not work. Try again shortly.', { status: res.status, code: json?.code, details: json?.details });
  }
  return json as T;
}

/** A failure as `{ message, fields }` for a form to show. */
export function describeFailure(error: unknown): { message: string; fields: Record<string, string> } {
  if (error instanceof ApiCallError) return { message: error.message, fields: error.fieldErrors() };
  return { message: 'Something went wrong. Please try again.', fields: {} };
}
