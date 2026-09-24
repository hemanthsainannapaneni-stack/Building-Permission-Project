import 'server-only';

/**
 * The storage boundary.
 *
 * Business code never learns where a file physically lives. It holds a
 * `storageKey` — an opaque, non-guessable string — and asks this interface to
 * put bytes there or get them back.
 *
 * ── Why there is no `publicUrl()` ──────────────────────────────────────
 *
 * There deliberately is not one, and adding one would be the single easiest
 * way to leak a citizen's documents. Every read goes through an authenticated
 * route that re-checks capability AND row scope and writes an audit row before
 * a single byte moves (docs/07-subsystems.md P.4). A URL that works without a
 * session is a URL that works after the session ends, after the person leaves
 * the department, and after it is pasted into a support ticket.
 */

export type PutInput = {
  key: string;
  body: Buffer;
  contentType: string;
  /** Original filename, for a Content-Disposition on the way back out. */
  filename?: string;
};

export type StoredObject = {
  key: string;
  sizeBytes: number;
};

export interface StorageProvider {
  readonly name: string;
  /** False when the provider is selected but not usable — checked at boot. */
  readonly configured: boolean;

  put(input: PutInput): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /**
   * Removes the object. Used only by the retention job and by quarantine —
   * ordinary deletion in this system is soft, because files outlive the
   * applications that produced them (P.6).
   */
  remove(key: string): Promise<void>;
}

/**
 * Builds a storage key that cannot be guessed from anything a user can see.
 *
 * `applications/{applicationId}/drawings/{random}.{ext}`
 *
 * The application id is in the path only so an operator can find a file during
 * an incident; it grants nothing, because the key is never accepted as input.
 * The random segment is what makes the object unreachable without a database
 * row pointing at it — so even a misconfigured bucket does not become a
 * directory listing of everyone's drawings.
 */
export function buildStorageKey(parts: {
  applicationId: string;
  kind: 'drawings' | 'bim' | 'documents' | 'reports' | 'orders' | 'receipts' | 'inspections' | 'nocs' | 'proceedings' | 'commencements' | 'occupancy';
  random: string;
  extension: string;
}): string {
  const ext = parts.extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `applications/${parts.applicationId}/${parts.kind}/${parts.random}${ext ? `.${ext}` : ''}`;
}
