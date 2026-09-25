import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { ScanStatus } from '@prisma/client';
import { prisma, type Tx } from '@/server/db/prisma';
import { env } from '@/server/config/env';
import { storage, buildStorageKey } from '@/server/storage';
import { checkContent, canonicalMime } from '@/server/storage/sniff';
import { enqueue, JOB_TYPES } from '@/server/jobs/queue';
import { badRequest, tooLarge } from '@/server/http/errors';

/**
 * The upload pipeline — docs/07-subsystems.md P.3.
 *
 *   multipart
 *      ▼
 *   1. size cap
 *   2. extension allow-list
 *   3. declared MIME allow-list
 *   4. MAGIC BYTES sniff — must agree with 2 and 3
 *   5. filename normalised
 *   6. sha256 checksum
 *   7. store under a NON-GUESSABLE key in private storage
 *   8. enqueue antivirus scan (scanStatus = PENDING)
 *   9. FileObject row
 *
 * One function, used by drawings now and documents in Phase 4, so a file
 * cannot enter the system down some other path that skipped step 4.
 *
 * ── Ordering matters ───────────────────────────────────────────────────
 *
 * The size cap runs FIRST, before the bytes are hashed or sniffed, so a
 * 500 MB upload is rejected without doing 500 MB of work. The storage write
 * runs LAST of the validations, so nothing unvalidated ever reaches the
 * bucket — a rejected file leaves no trace to clean up.
 */

export type StoreUploadInput = {
  /** The owning record's id — an application's, or a developer registration's (see `root`). */
  applicationId: string;
  kind: 'drawings' | 'bim' | 'documents' | 'reports' | 'inspections' | 'nocs' | 'proceedings' | 'commencements' | 'occupancy' | 'developers' | 'professionals';
  root?: 'applications' | 'developer-registrations' | 'professional-registrations';
  file: {
    name: string;
    type: string;
    bytes: Buffer;
  };
  uploadedById: string;
  /** Extensions this call site accepts. Narrower than the platform list. */
  allowedExtensions: readonly string[];
  /** Overrides the global cap, for a document type with its own limit. */
  maxBytes?: number;
};

export type StoredFile = {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  scanStatus: ScanStatus;
};

export async function storeUpload(input: StoreUploadInput): Promise<StoredFile> {
  const { file } = input;
  const maxBytes = input.maxBytes ?? env.maxUploadBytes;

  // ── 1. Size ───────────────────────────────────────────────────────────
  if (file.bytes.byteLength === 0) {
    throw badRequest('That file is empty.');
  }
  if (file.bytes.byteLength > maxBytes) {
    throw tooLarge(
      `That file is ${mb(file.bytes.byteLength)} MB. The limit is ${mb(maxBytes)} MB.`
    );
  }

  // ── 2. Extension ──────────────────────────────────────────────────────
  const extension = extensionOf(file.name);
  if (!extension || !input.allowedExtensions.includes(extension)) {
    throw badRequest(
      `Only ${humanList(input.allowedExtensions.map((e) => `.${e}`))} files are accepted here.`
    );
  }

  // ── 3 + 4. Declared type, and the bytes that must agree with it ───────
  const content = checkContent(file.bytes, file.type || 'application/octet-stream', extension);
  if (!content.ok) throw badRequest(content.reason);

  // ── 5. Filename ───────────────────────────────────────────────────────
  const originalName = safeFilename(file.name);

  // ── 6. Checksum ───────────────────────────────────────────────────────
  const checksumSha256 = createHash('sha256').update(file.bytes).digest('hex');

  // ── 7. Store ──────────────────────────────────────────────────────────
  // The MIME recorded is the SNIFFED one, not the declared one. What gets
  // served back on download is therefore derived from the bytes, which is
  // what stops a stored `text/html` being replayed at a browser.
  const mimeType = canonicalMime(content.kind);
  const storageKey = buildStorageKey({
    applicationId: input.applicationId,
    kind: input.kind,
    root: input.root,
    random: randomBytes(24).toString('hex'),
    extension,
  });

  await storage.put({ key: storageKey, body: file.bytes, contentType: mimeType, filename: originalName });

  // ── 8 + 9. Row, then scan ─────────────────────────────────────────────
  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.fileObject.create({
        data: {
          storageKey,
          bucket: storage.name,
          originalName,
          mimeType,
          sizeBytes: file.bytes.byteLength,
          checksumSha256,
          // PENDING until a scanner says otherwise. The download route refuses
          // anything not yet cleared, so an unscanned file cannot be handed to
          // another user in the window before the worker runs.
          scanStatus: 'PENDING',
          uploadedById: input.uploadedById,
        },
      });

      await enqueue(tx, {
        type: JOB_TYPES.SCAN_FILE,
        payload: { fileObjectId: row.id },
        // One scan per file, however many times this is retried.
        dedupeKey: `scan:${row.id}`,
      });

      return row;
    });

    return created as StoredFile;
  } catch (err) {
    // The bytes are already in storage but the row that would ever find them
    // again is not. Without this the bucket accumulates orphans that no
    // retention job can identify, because retention works from FileObject.
    await storage.remove(storageKey).catch(() => {});
    throw err;
  }
}

/**
 * Reads a stored file back, refusing anything the scanner has not cleared.
 *
 * The refusal is deliberately not "not found": the person uploaded this file
 * and needs to know it is being checked, not that it vanished.
 */
export async function readFileObject(fileObjectId: string): Promise<{
  bytes: Buffer;
  file: { originalName: string; mimeType: string; sizeBytes: number };
}> {
  const file = await prisma.fileObject.findFirst({
    where: { id: fileObjectId, deletedAt: null },
  });

  if (!file) throw badRequest('That file is no longer available.');

  assertServable(file.scanStatus as ScanStatus);

  return {
    bytes: await storage.get(file.storageKey),
    file: {
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    },
  };
}

/**
 * Whether a file may be handed to a user.
 *
 * SKIPPED counts as servable: it means no scanner is configured, which is the
 * development default and an accepted deployment choice. It is labelled "Not
 * scanned" in the UI rather than "Clean", so the distinction stays visible.
 */
export function assertServable(scanStatus: ScanStatus): void {
  if (scanStatus === 'CLEAN' || scanStatus === 'SKIPPED') return;

  if (scanStatus === 'PENDING') {
    throw badRequest('That file is still being checked for viruses. Try again in a moment.');
  }
  if (scanStatus === 'INFECTED') {
    throw badRequest('That file was found to contain a virus and has been quarantined.');
  }
  throw badRequest('That file could not be checked for viruses, so it cannot be downloaded.');
}

export const isServable = (scanStatus: ScanStatus): boolean =>
  scanStatus === 'CLEAN' || scanStatus === 'SKIPPED';

/**
 * Soft-deletes a file object and removes its bytes.
 *
 * Used by quarantine. Ordinary deletion in this system is soft and the bytes
 * stay, because files outlive the applications that produced them (P.6) — an
 * infected upload is the exception, and it goes.
 */
export async function quarantineFile(db: Tx, fileObjectId: string, detail: string) {
  const file = await db.fileObject.update({
    where: { id: fileObjectId },
    data: { scanStatus: 'INFECTED', scanDetail: detail.slice(0, 500), deletedAt: new Date() },
  });

  await storage.remove(file.storageKey).catch(() => {});
  return file;
}

// ── Helpers ───────────────────────────────────────────────────────────────

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Normalises a filename for DISPLAY and for the download's
 * Content-Disposition. It is never used to build a path — the storage key is
 * generated independently — so this is about not echoing hostile text back
 * into a header or a page, not about traversal.
 */
export function safeFilename(name: string): string {
  const base = name
    .normalize('NFKD')
    // Path separators first, so a/b/c.pdf cannot quietly become abc.pdf and
    // lose the fact that something odd was attempted.
    .replace(/[\\/]/g, '_')
    // Control characters and quotes: these are what would break out of a
    // Content-Disposition header if they survived to the download route.
    .replace(/[\u0000-\u001F\u007F"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // The allow-list is what actually decides. Anything outside it becomes an
  // underscore rather than vanishing, so two files differing only in stripped
  // characters do not silently end up with the same display name.
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180);
  return cleaned || 'upload';
}

function humanList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
