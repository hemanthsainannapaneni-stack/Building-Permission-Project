'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Save } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Checkbox, CheckboxField } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/toast';
import { api } from '@/features/applications/api';
import {
  CONSENT_TEXT,
  PROFESSIONAL_DOCUMENTS,
  PROFESSIONAL_DOCUMENT_LABEL,
  REQUIRED_PROFESSIONAL_DOCUMENTS,
  latestProfessionalDocuments,
  professionalProblems,
  type ProfessionalDocumentKind,
} from '@/lib/professional-registration';
import { postForm, reportError, selectClass } from '@/features/proceedings/shared';
import type { LinkableAccount, ProfessionalRegistrationView, ProfessionalTypeOption } from './types';

type Values = {
  professionalType: string;
  name: string;
  userId: string;
  licenceNo: string;
  registrationBody: string;
  qualification: string;
  experienceYears: string;
  organization: string;
  address: string;
  district: string;
  pincode: string;
  mobile: string;
  email: string;
  licenceValidFrom: string;
  licenceValidTo: string;
  consentGiven: boolean;
};

const fromView = (r: ProfessionalRegistrationView): Values => ({
  professionalType: r.professionalType,
  name: r.name,
  userId: r.userId ?? '',
  licenceNo: r.licenceNo,
  registrationBody: r.registrationBody,
  qualification: r.qualification,
  experienceYears: r.experienceYears == null ? '' : String(r.experienceYears),
  organization: r.organization,
  address: r.address,
  district: r.district,
  pincode: r.pincode,
  mobile: r.mobile,
  email: r.email,
  licenceValidFrom: r.licenceValidFrom?.slice(0, 10) ?? '',
  licenceValidTo: r.licenceValidTo?.slice(0, 10) ?? '',
  consentGiven: r.consentGiven,
});

/**
 * The registration form — opening a draft, or editing one. Where the
 * professional already signs in to the portal, the registration is LINKED to
 * that account rather than describing the person a second time.
 */
export function ProfessionalForm({ existing, types, demoAllowed }: { existing?: ProfessionalRegistrationView; types: ProfessionalTypeOption[]; demoAllowed: boolean }) {
  const router = useRouter();
  const active = types.filter((t) => t.isActive || t.code === existing?.professionalType);
  const first = active[0];
  const [v, setV] = React.useState<Values>(
    existing
      ? fromView(existing)
      : {
          professionalType: first?.code ?? '',
          name: '',
          userId: '',
          licenceNo: '',
          registrationBody: first?.body ?? '',
          qualification: '',
          experienceYears: '',
          organization: '',
          address: '',
          district: '',
          pincode: '',
          mobile: '',
          email: '',
          licenceValidFrom: '',
          licenceValidTo: '',
          consentGiven: false,
        }
  );
  const [accounts, setAccounts] = React.useState<LinkableAccount[] | null>(null);
  const [files, setFiles] = React.useState<Partial<Record<ProfessionalDocumentKind, File>>>({});
  const [demo, setDemo] = React.useState<ProfessionalDocumentKind[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const type = types.find((t) => t.code === v.professionalType);

  React.useEffect(() => {
    api
      .get<LinkableAccount[]>('/api/professionals/accounts')
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  const chooseType = (code: string) => {
    const t = types.find((x) => x.code === code);
    const prevBody = types.find((x) => x.code === v.professionalType)?.body ?? '';
    setV({ ...v, professionalType: code, registrationBody: !v.registrationBody || v.registrationBody === prevBody ? t?.body ?? '' : v.registrationBody, userId: t?.canHoldFile ? v.userId : '' });
  };
  const chooseAccount = (id: string) => {
    const a = accounts?.find((x) => x.id === id);
    setV({ ...v, userId: id, ...(a ? { name: v.name || a.name, email: v.email || a.email, licenceNo: v.licenceNo || a.licenceNo } : {}) });
  };

  const problems = professionalProblems({ ...v, licenceValidTo: v.licenceValidTo || null }, types, new Date());
  const have = new Set<string>([...latestProfessionalDocuments(existing?.documents ?? []).keys(), ...Object.keys(files).filter((k) => files[k as ProfessionalDocumentKind]), ...demo]);
  const missing = REQUIRED_PROFESSIONAL_DOCUMENTS.filter((k) => !have.has(k));

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const form = new FormData();
      for (const [k, val] of Object.entries(v)) form.set(k, typeof val === 'boolean' ? String(val) : val);
      for (const [k, f] of Object.entries(files)) if (f) form.set(`doc_${k}`, f);
      if (demo.length) {
        form.set('demoDocuments', 'true');
        form.set('demoKinds', demo.join(','));
      }
      if (existing) form.set('expectedStatus', existing.status);
      const res = await postForm<{ id: string; applicationNumber: string }>(existing ? `/api/professionals/${existing.id}` : '/api/professionals', form);
      toast.success(existing ? 'Draft saved' : `Draft ${res.applicationNumber} opened`);
      router.push(`/ltp/${res.id}`);
      router.refresh();
    } catch (error) {
      setErrors(reportError(error));
    } finally {
      setBusy(false);
    }
  };
  const err = (k: string) => errors[k];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>LTP particulars</CardTitle>
          <CardDescription>As the application received at the office states it.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="LTP type" htmlFor="pr-type" required error={err('professionalType')} hint="Types are configured on Settings → LTP Types.">
            <select id="pr-type" className={`${selectClass} w-full`} value={v.professionalType} onChange={(e) => chooseType(e.target.value)}>
              {active.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name" htmlFor="pr-name" required error={err('name')}>
            <Input id="pr-name" value={v.name} onChange={set('name')} />
          </Field>
          <Field
            label="Portal account"
            htmlFor="pr-account"
            error={err('userId')}
            hint={type?.canHoldFile ? 'Link the account the LTP already signs in with. Required for them to file or take over applications.' : `${type ? `A ${type.label.toLowerCase()}` : 'This type'} does not hold files; no account is linked.`}
          >
            <select id="pr-account" className={`${selectClass} w-full`} value={v.userId} onChange={(e) => chooseAccount(e.target.value)} disabled={!type?.canHoldFile || !accounts}>
              <option value="">{accounts ? '— No portal account —' : 'Loading accounts…'}</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.email}
                  {a.licenceNo ? ` · ${a.licenceNo}` : ''}
                  {a.registrations.length ? ` · holds ${a.registrations.map((x) => x.registrationNumber ?? x.status.toLowerCase()).join(', ')}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Qualification" htmlFor="pr-qual" required error={err('qualification')}>
            <Input id="pr-qual" value={v.qualification} onChange={set('qualification')} placeholder="B.Arch, M.Tech (Structures)…" />
          </Field>
          <Field label="Experience (years)" htmlFor="pr-exp" error={err('experienceYears')}>
            <Input id="pr-exp" inputMode="numeric" value={v.experienceYears} onChange={set('experienceYears')} />
          </Field>
          <Field label="Organisation" htmlFor="pr-org" error={err('organization')}>
            <Input id="pr-org" value={v.organization} onChange={set('organization')} placeholder="Firm or employer, if any" />
          </Field>
          <Field label="Address" htmlFor="pr-addr" required error={err('address')}>
            <Textarea id="pr-addr" rows={2} value={v.address} onChange={set('address')} />
          </Field>
          <Field label="District" htmlFor="pr-dist" error={err('district')}>
            <Input id="pr-dist" value={v.district} onChange={set('district')} />
          </Field>
          <Field label="PIN code" htmlFor="pr-pin" error={err('pincode')}>
            <Input id="pr-pin" inputMode="numeric" maxLength={6} value={v.pincode} onChange={set('pincode')} />
          </Field>
          <Field label="Mobile" htmlFor="pr-mobile" required error={err('mobile')}>
            <Input id="pr-mobile" inputMode="numeric" maxLength={10} value={v.mobile} onChange={set('mobile')} />
          </Field>
          <Field label="Email" htmlFor="pr-email" required error={err('email')}>
            <Input id="pr-email" type="email" value={v.email} onChange={set('email')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Licence</CardTitle>
          <CardDescription>The licence the registration body issued. The authority’s registration never runs past its validity.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Licence number" htmlFor="pr-lic" required error={err('licenceNo')}>
            <Input id="pr-lic" value={v.licenceNo} onChange={set('licenceNo')} />
          </Field>
          <Field label="Registration body" htmlFor="pr-body" required error={err('registrationBody')}>
            <Input id="pr-body" value={v.registrationBody} onChange={set('registrationBody')} />
          </Field>
          <Field label="Valid from" htmlFor="pr-from" error={err('licenceValidFrom')}>
            <Input id="pr-from" type="date" value={v.licenceValidFrom} onChange={set('licenceValidFrom')} />
          </Field>
          <Field label="Valid to" htmlFor="pr-to" required error={err('licenceValidTo')}>
            <Input id="pr-to" type="date" value={v.licenceValidTo} onChange={set('licenceValidTo')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supporting documents</CardTitle>
          <CardDescription>PDF or image, 10 MB each. The verifying desk checks each one. Required marks are a demonstration rule, not a published list.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {PROFESSIONAL_DOCUMENTS.map((kind) => {
            const onFile = existing ? latestProfessionalDocuments(existing.documents).get(kind)?.doc : undefined;
            return (
              <div key={kind} className="grid items-center gap-1 border-b border-border pb-2 sm:grid-cols-[20rem_1fr]">
                <label htmlFor={`pr-doc-${kind}`} className="text-small text-text">
                  {PROFESSIONAL_DOCUMENT_LABEL[kind]}
                  {REQUIRED_PROFESSIONAL_DOCUMENTS.includes(kind) && <span className="text-danger"> *</span>}
                  {onFile && (
                    <span className="block text-caption text-text-muted">
                      On file: {onFile.isDemo ? 'demo placeholder' : onFile.fileName}
                      {onFile.carriedForward ? ' (carried forward)' : ''}
                    </span>
                  )}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input id={`pr-doc-${kind}`} type="file" accept=".pdf,.png,.jpg,.jpeg" className="block max-w-[16rem] text-small" onChange={(e) => setFiles({ ...files, [kind]: e.target.files?.[0] })} />
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

      <Card>
        <CardHeader>
          <CardTitle>Consent</CardTitle>
          <CardDescription>Demonstration wording. Recorded with the registration, with the moment it was given.</CardDescription>
        </CardHeader>
        <CardContent>
          <CheckboxField
            id="pr-consent"
            label="The LTP gives this consent"
            description={CONSENT_TEXT}
            checked={v.consentGiven}
            error={err('consentGiven')}
            onChange={(e) => setV({ ...v, consentGiven: e.target.checked })}
          />
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
                <li key={k}>{PROFESSIONAL_DOCUMENT_LABEL[k]} is attached.</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={save} loading={busy} disabled={busy || v.name.trim().length < 2 || !v.professionalType}>
          <Save className="size-4" /> {existing ? 'Save draft' : 'Open draft'}
        </Button>
      </div>
    </div>
  );
}
