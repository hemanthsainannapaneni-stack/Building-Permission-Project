'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatBytes, extensionOf } from '@/lib/drawings';
import { BIM_DISCIPLINES, BIM_FILE_KINDS, acceptFor, extensionsFor } from '@/lib/bim';
import { NativeSelect } from './native-select';

/**
 * Uploads one BIM deliverable, or the next version of one.
 *
 * XHR rather than fetch for the same reason as the drawing upload: a 20 MB
 * IFC model over a municipal connection needs a real progress bar. The
 * extension check here is a courtesy; the server sniffs the bytes and reads
 * the model before anything is stored against the application.
 */
export function BimUploadPanel({
  applicationId,
  maxUploadBytes,
  bimModelId,
  fixedKind,
  onUploaded,
  onCancel,
}: {
  applicationId: string;
  maxUploadBytes: number;
  /** Present when adding a version to an existing deliverable. */
  bimModelId?: string;
  fixedKind?: string;
  onUploaded: () => void;
  onCancel?: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const xhrRef = React.useRef<XMLHttpRequest | null>(null);

  const [kind, setKind] = React.useState(fixedKind ?? 'IFC_MODEL');
  const [discipline, setDiscipline] = React.useState('FEDERATED');
  const [title, setTitle] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const busy = progress !== null;
  const allowed = extensionsFor(kind);
  const kindDef = BIM_FILE_KINDS.find((k) => k.code === kind);

  React.useEffect(() => () => xhrRef.current?.abort(), []);

  function choose(next: File | null) {
    setError(null);
    if (!next) return setFile(null);
    if (!allowed.includes(extensionOf(next.name))) {
      setFile(null);
      return setError(
        `${next.name} is not accepted as ${kindDef?.label ?? 'this deliverable'}. Upload ${allowed.map((e) => `.${e}`).join(', ')}.`
      );
    }
    if (next.size === 0) return setError(`${next.name} is empty.`);
    if (next.size > maxUploadBytes) {
      return setError(`${next.name} is ${formatBytes(next.size)}. The limit is ${formatBytes(maxUploadBytes)}.`);
    }
    setFile(next);
  }

  function upload() {
    if (!file) return;
    setError(null);
    setProgress(0);

    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    form.append('discipline', discipline);
    if (title.trim()) form.append('title', title.trim());
    if (remarks.trim()) form.append('remarks', remarks.trim());
    if (bimModelId) form.append('bimModelId', bimModelId);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      xhrRef.current = null;
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        let description = file.name;
        try {
          const facts = (JSON.parse(xhr.responseText) as { facts?: { parsed?: boolean; schema?: string; storeys?: unknown[] } })
            .facts;
          if (facts?.parsed) description = `${facts.schema} · ${facts.storeys?.length ?? 0} storeys read from the model`;
          else if (facts && !facts.parsed) description = 'Stored, but the model could not be read — see the readiness check.';
        } catch {
          /* keep the file name */
        }
        toast.success(bimModelId ? 'New version uploaded' : 'BIM file uploaded', { description });
        setFile(null);
        setRemarks('');
        if (inputRef.current) inputRef.current.value = '';
        onUploaded();
        return;
      }
      let message = 'That upload was refused.';
      try {
        message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
      } catch {
        /* not JSON */
      }
      setError(message);
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setProgress(null);
      setError('The upload could not reach the server. Check your connection and try again.');
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      setProgress(null);
    };
    xhr.open('POST', `/api/applications/${applicationId}/bim/models`);
    xhr.send(form);
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded border border-danger/30 bg-danger-bg px-3 py-2 text-small text-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {!bimModelId && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Deliverable" htmlFor="bim-kind" required hint={kindDef?.hint}>
            <NativeSelect
              id="bim-kind"
              value={kind}
              disabled={busy}
              options={BIM_FILE_KINDS.map((k) => ({ code: k.code, label: k.label }))}
              onChange={(v) => {
                setKind(v);
                setFile(null);
                setError(null);
              }}
            />
          </Field>
          {kind === 'IFC_MODEL' && (
            <Field label="Discipline" htmlFor="bim-discipline">
              <NativeSelect
                id="bim-discipline"
                value={discipline}
                disabled={busy}
                options={[{ code: 'FEDERATED', label: 'Federated (all disciplines)' }, ...BIM_DISCIPLINES]}
                onChange={setDiscipline}
              />
            </Field>
          )}
          <Field label="Title" htmlFor="bim-title" hint="Optional.">
            <Input id="bim-title" value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) choose(e.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          'rounded border-2 border-dashed p-6 text-center transition-colors',
          dragging ? 'border-primary bg-primary-subtle' : 'border-border-strong bg-surface-sunk',
          busy && 'opacity-60'
        )}
      >
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <CheckCircle2 className="size-5 shrink-0 text-success" />
            <div className="min-w-0 text-left">
              <p className="truncate text-small font-medium text-text">{file.name}</p>
              <p className="text-caption text-text-muted">{formatBytes(file.size)}</p>
            </div>
            {!busy && (
              <Button size="icon" variant="ghost" onClick={() => choose(null)} aria-label="Remove file">
                <X className="size-4" />
              </Button>
            )}
          </div>
        ) : (
          <>
            <FileUp className="mx-auto mb-2 size-6 text-text-subtle" aria-hidden />
            <p className="text-small text-text">
              Drag a file here, or{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="rounded font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                browse for one
              </button>
              .
            </p>
            <p className="mt-1 text-caption text-text-muted">
              {allowed.map((e) => `.${e}`).join(', ')} — up to {formatBytes(maxUploadBytes)}.
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={acceptFor(kind)}
          className="sr-only"
          aria-label="Choose a BIM file"
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
      </div>

      {busy && (
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-caption text-text-muted" aria-live="polite">
              Uploading… {progress}%
            </p>
            <button
              type="button"
              onClick={() => xhrRef.current?.abort()}
              className="rounded text-caption text-text-muted hover:text-text"
            >
              Cancel
            </button>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunk" role="progressbar" aria-valuenow={progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <Field
        label="Remarks"
        htmlFor="bim-remarks"
        hint={bimModelId ? 'What changed in this version?' : 'Optional note for the reviewing officer.'}
      >
        <Input id="bim-remarks" value={remarks} disabled={busy} onChange={(e) => setRemarks(e.target.value)} />
      </Field>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button variant="primary" onClick={upload} disabled={!file || busy} loading={busy}>
          <Upload className="size-4" />
          {bimModelId ? 'Upload new version' : 'Upload'}
        </Button>
      </div>
    </div>
  );
}
