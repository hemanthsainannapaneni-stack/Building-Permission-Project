'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Save } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/toast';
import {
  DEVELOPER_DOCUMENTS,
  DEVELOPER_DOCUMENT_LABEL,
  DEVELOPER_TYPES,
  DEVELOPER_TYPE_LABEL,
  INCORPORATION_LABEL,
  isDeveloperType,
  latestDocuments,
  particularsProblems,
  requiredDeveloperDocuments,
  requiresOrganization,
  type DeveloperDocument,
  type DeveloperDocumentKind,
} from '@/lib/developer-registration';
import { postForm, reportError, selectClass } from '@/features/proceedings/shared';
import type { DeveloperRegistrationView } from './types';

type Values = {
  developerType: string;
  developerName: string;
  organization: string;
  authorizedPerson: string;
  authorizedDesignation: string;
  address: string;
  district: string;
  pincode: string;
  mobile: string;
  email: string;
  pan: string;
  gstin: string;
  incorporationNo: string;
  incorporationDate: string;
  reraNo: string;
  experienceYears: string;
  projectsCompleted: string;
  registrationInfo: string;
};

const BLANK: Values = {
  developerType: 'PRIVATE_LIMITED',
  developerName: '',
  organization: '',
  authorizedPerson: '',
  authorizedDesignation: '',
  address: '',
  district: '',
  pincode: '',
  mobile: '',
  email: '',
  pan: '',
  gstin: '',
  incorporationNo: '',
  incorporationDate: '',
  reraNo: '',
  experienceYears: '',
  projectsCompleted: '',
  registrationInfo: '',
};

const fromView = (r: DeveloperRegistrationView): Values => ({
  developerType: r.developerType,
  developerName: r.developerName,
  organization: r.organization,
  authorizedPerson: r.authorizedPerson,
  authorizedDesignation: r.authorizedDesignation,
  address: r.address,
  district: r.district,
  pincode: r.pincode,
  mobile: r.mobile,
  email: r.email,
  pan: r.pan,
  gstin: r.gstin,
  incorporationNo: r.incorporationNo,
  incorporationDate: r.incorporationDate?.slice(0, 10) ?? '',
  reraNo: r.reraNo,
  experienceYears: r.experienceYears == null ? '' : String(r.experienceYears),
  projectsCompleted: r.projectsCompleted == null ? '' : String(r.projectsCompleted),
  registrationInfo: r.registrationInfo,
});

/**
 * The registration form — opening a draft, or editing one. A draft may be
 * saved incomplete; what submission will refuse is listed as it is typed,
 * from the same rules the server applies.
 */
export function DeveloperForm({ existing, demoAllowed }: { existing?: DeveloperRegistrationView; demoAllowed: boolean }) {
  const router = useRouter();
  const [v, setV] = React.useState<Values>(existing ? fromView(existing) : BLANK);
  const [files, setFiles] = React.useState<Partial<Record<DeveloperDocumentKind, File>>>({});
  const [demo, setDemo] = React.useState<DeveloperDocumentKind[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  const problems = particularsProblems(v);
  const have = new Set<string>([...latestDocuments(existing?.documents ?? []).keys(), ...Object.keys(files).filter((k) => files[k as DeveloperDocumentKind]), ...demo]);
  const required = requiredDeveloperDocuments(v.developerType, v.gstin);
  const missing = required.filter((k) => !have.has(k));
  const org = requiresOrganization(v.developerType);
  const incLabel = isDeveloperType(v.developerType) ? INCORPORATION_LABEL[v.developerType] : 'Registration number';

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const form = new FormData();
      for (const [k, val] of Object.entries(v)) form.set(k, val);
      for (const [k, f] of Object.entries(files)) if (f) form.set(`doc_${k}`, f);
      if (demo.length) {
        form.set('demoDocuments', 'true');
        form.set('demoKinds', demo.join(','));
      }
      if (existing) form.set('expectedStatus', existing.status);
      const res = await postForm<{ id: string; applicationNumber: string }>(existing ? `/api/developers/${existing.id}` : '/api/developers', form);
      toast.success(existing ? 'Draft saved' : `Draft ${res.applicationNumber} opened`);
      router.push(`/developers/${res.id}`);
      router.refresh();
    } catch (error) {
      setErrors(reportError(error));
    } finally {
      setBusy(false);
    }
  };

  const err = (k: keyof Values) => errors[k];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Developer</CardTitle>
          <CardDescription>As the developer’s application received at the office states it.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Developer type" htmlFor="dv-type" required error={err('developerType')}>
            <select id="dv-type" className={`${selectClass} w-full`} value={v.developerType} onChange={set('developerType')}>
              {DEVELOPER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DEVELOPER_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={org ? 'Developer / brand name' : 'Developer name'} htmlFor="dv-name" required error={err('developerName')}>
            <Input id="dv-name" value={v.developerName} onChange={set('developerName')} />
          </Field>
          <Field label="Organisation (registered name)" htmlFor="dv-org" required={org} error={err('organization')} hint={org ? undefined : 'Not needed for an individual.'}>
            <Input id="dv-org" value={v.organization} onChange={set('organization')} disabled={!org && !v.organization} />
          </Field>
          <Field label="Authorised person" htmlFor="dv-auth" required error={err('authorizedPerson')}>
            <Input id="dv-auth" value={v.authorizedPerson} onChange={set('authorizedPerson')} />
          </Field>
          <Field label="Designation" htmlFor="dv-desig" error={err('authorizedDesignation')}>
            <Input id="dv-desig" value={v.authorizedDesignation} onChange={set('authorizedDesignation')} placeholder="Managing Director, Partner…" />
          </Field>
          <div className="hidden lg:block" />
          <Field label="Address" htmlFor="dv-addr" required error={err('address')}>
            <Textarea id="dv-addr" rows={2} value={v.address} onChange={set('address')} />
          </Field>
          <Field label="District" htmlFor="dv-dist" error={err('district')}>
            <Input id="dv-dist" value={v.district} onChange={set('district')} />
          </Field>
          <Field label="PIN code" htmlFor="dv-pin" error={err('pincode')}>
            <Input id="dv-pin" inputMode="numeric" maxLength={6} value={v.pincode} onChange={set('pincode')} />
          </Field>
          <Field label="Mobile" htmlFor="dv-mobile" required error={err('mobile')}>
            <Input id="dv-mobile" inputMode="numeric" maxLength={10} value={v.mobile} onChange={set('mobile')} />
          </Field>
          <Field label="Email" htmlFor="dv-email" required error={err('email')}>
            <Input id="dv-email" type="email" value={v.email} onChange={set('email')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registration information</CardTitle>
          <CardDescription>Tax and constitution particulars. PAN and GSTIN are checked for form, and against each other and the developer type.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="PAN" htmlFor="dv-pan" required error={err('pan')}>
            <Input id="dv-pan" className="font-mono uppercase" maxLength={10} value={v.pan} onChange={(e) => setV({ ...v, pan: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="GSTIN" htmlFor="dv-gst" error={err('gstin')} hint="Optional. When given, the GST certificate is required.">
            <Input id="dv-gst" className="font-mono uppercase" maxLength={15} value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="RERA registration" htmlFor="dv-rera" error={err('reraNo')}>
            <Input id="dv-rera" value={v.reraNo} onChange={set('reraNo')} />
          </Field>
          <Field label={incLabel} htmlFor="dv-inc" error={err('incorporationNo')}>
            <Input id="dv-inc" value={v.incorporationNo} onChange={set('incorporationNo')} />
          </Field>
          <Field label="Date of incorporation / registration" htmlFor="dv-incd" error={err('incorporationDate')}>
            <Input id="dv-incd" type="date" value={v.incorporationDate} onChange={set('incorporationDate')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Years in business" htmlFor="dv-exp" error={err('experienceYears')}>
              <Input id="dv-exp" inputMode="numeric" value={v.experienceYears} onChange={set('experienceYears')} />
            </Field>
            <Field label="Projects completed" htmlFor="dv-proj" error={err('projectsCompleted')}>
              <Input id="dv-proj" inputMode="numeric" value={v.projectsCompleted} onChange={set('projectsCompleted')} />
            </Field>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Other registration information" htmlFor="dv-info" error={err('registrationInfo')}>
              <Textarea id="dv-info" rows={2} value={v.registrationInfo} onChange={set('registrationInfo')} placeholder="Registrations held with other authorities, major projects, anything the application states." />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supporting documents</CardTitle>
          <CardDescription>
            PDF or image, 10 MB each. Required marks follow the developer type and GSTIN — a demonstration rule, not a published list.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {DEVELOPER_DOCUMENTS.map((kind) => {
            const onFile = existing ? latestDocuments(existing.documents).get(kind)?.doc : undefined;
            return (
              <div key={kind} className="grid items-center gap-1 border-b border-border pb-2 sm:grid-cols-[20rem_1fr]">
                <label htmlFor={`dv-doc-${kind}`} className="text-small text-text">
                  {DEVELOPER_DOCUMENT_LABEL[kind]}
                  {required.includes(kind) && <span className="text-danger"> *</span>}
                  {onFile && <span className="block text-caption text-text-muted">On file: {docName(onFile)}</span>}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input id={`dv-doc-${kind}`} type="file" accept=".pdf,.png,.jpg,.jpeg" className="block max-w-[16rem] text-small" onChange={(e) => setFiles({ ...files, [kind]: e.target.files?.[0] })} />
                  {demoAllowed && !files[kind] && (
                    <label className="flex items-center gap-1.5 text-caption text-text-muted">
                      <Checkbox checked={demo.includes(kind)} onChange={(e) => setDemo(e.target.checked ? [...demo, kind] : demo.filter((k) => k !== kind))} />
                      Demo placeholder
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {(Object.keys(problems).length > 0 || missing.length > 0) && (
        <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/5 px-3 py-2 text-small">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium text-text">The draft can be saved, but not submitted until:</p>
            <ul className="mt-1 list-disc pl-5 text-text-muted">
              {Object.values(problems).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {missing.map((k) => (
                <li key={k}>{DEVELOPER_DOCUMENT_LABEL[k]} is attached.</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={save} loading={busy} disabled={busy || v.developerName.trim().length < 2}>
          <Save className="size-4" /> {existing ? 'Save draft' : 'Open draft'}
        </Button>
      </div>
    </div>
  );
}

const docName = (d: DeveloperDocument) => (d.isDemo ? 'demo placeholder' : d.fileName) + (d.carriedForward ? ' (carried forward)' : '');
