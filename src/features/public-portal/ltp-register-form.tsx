'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronRight, Loader2, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Panel, Notice } from '@/features/public-portal/primitives';
import { submitLtpRegistrationAction } from '@/app/(public)/public/ltp/register/actions';

type FormState = {
  status: 'idle' | 'submitting' | 'success' | 'error';
  message?: string;
  applicationNumber?: string;
};

const STEPS = [
  { id: 'personal', title: 'Personal Info' },
  { id: 'professional', title: 'Professional Info' },
  { id: 'contact', title: 'Contact Info' },
  { id: 'account', title: 'Account & Docs' },
];

export function LtpRegisterForm({ professionalTypes }: { professionalTypes: { code: string; label: string }[] }) {
  const router = useRouter();
  const [state, setState] = React.useState<FormState>({ status: 'idle' });
  const [currentStep, setCurrentStep] = React.useState(0);
  const formRef = React.useRef<HTMLFormElement>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (currentStep < STEPS.length - 1) {
      // Prevent default submission on enter key if not on last step
      return;
    }
    
    // Check password match
    const fd = new FormData(event.currentTarget);
    if (fd.get('password') !== fd.get('confirmPassword')) {
      setState({ status: 'error', message: 'Passwords do not match.' });
      return;
    }

    setState({ status: 'submitting' });
    try {
      // Combine name parts for backend
      const fullName = [fd.get('salutation'), fd.get('firstName'), fd.get('middleName'), fd.get('lastName')]
        .filter(Boolean)
        .join(' ');
      
      fd.set('name', fullName);

      const res = await submitLtpRegistrationAction(fd, {});
      if (res.success) {
        setState({ status: 'success', applicationNumber: res.applicationNumber });
      } else {
        setState({ status: 'error', message: res.message });
      }
    } catch (err: any) {
      setState({ status: 'error', message: err?.message || 'Submission failed' });
    }
  }

  const validateCurrentStep = () => {
    if (!formRef.current) return false;
    const currentSection = formRef.current.querySelector(`#step-${currentStep}`);
    if (!currentSection) return true;
    
    const inputs = currentSection.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
    let isValid = true;
    for (const input of Array.from(inputs)) {
      if (!input.checkValidity()) {
        input.reportValidity();
        isValid = false;
        break;
      }
    }
    return isValid;
  };

  const nextStep = () => {
    if (validateCurrentStep()) {
      setCurrentStep(s => Math.min(s + 1, STEPS.length - 1));
      setState({ status: 'idle' }); // Clear errors
    }
  };

  const prevStep = () => {
    setCurrentStep(s => Math.max(s - 1, 0));
    setState({ status: 'idle' });
  };

  if (state.status === 'success') {
    return (
      <div className="space-y-6">
        <Panel className="border-success/30 bg-success-bg/30">
          <div className="flex flex-col items-center py-8 text-center">
            <div className="mb-4 rounded-full bg-success/20 p-3">
              <CheckCircle2 className="size-10 text-success" />
            </div>
            <h2 className="text-2xl font-bold text-text">Registration Submitted Successfully</h2>
            <p className="mt-2 max-w-lg text-text-muted">
              Your application has been received and is now under process. Please keep your application number safe for future reference.
            </p>
            <div className="mt-6 rounded-lg bg-surface px-6 py-4 shadow-sm border border-border">
              <p className="text-small uppercase tracking-wide text-text-muted">Application Number</p>
              <p className="mt-1 font-mono text-3xl font-bold text-primary">{state.applicationNumber}</p>
            </div>
            <div className="mt-8">
              <Button asChild>
                <a href={`/public/status?ref=${encodeURIComponent(state.applicationNumber || '')}`}>
                  Track Application Status <ChevronRight className="ml-2 size-4" />
                </a>
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Wizard Progress */}
      <nav aria-label="Progress">
        <ol role="list" className="space-y-4 md:flex md:space-x-8 md:space-y-0">
          {STEPS.map((step, index) => (
            <li key={step.id} className="md:flex-1">
              <div className={`group flex flex-col border-l-4 py-2 pl-4 md:border-l-0 md:border-t-4 md:pb-0 md:pl-0 md:pt-4 transition-colors ${
                index < currentStep ? 'border-primary' : index === currentStep ? 'border-primary' : 'border-border'
              }`}>
                <span className={`text-sm font-medium ${
                  index < currentStep ? 'text-primary' : index === currentStep ? 'text-primary' : 'text-text-muted'
                }`}>
                  Step {index + 1}
                </span>
                <span className="text-sm font-medium text-text">{step.title}</span>
              </div>
            </li>
          ))}
        </ol>
      </nav>

      <form ref={formRef} onSubmit={onSubmit} className="space-y-8">
        {state.status === 'error' && (
          <Notice tone="danger" title="Registration Failed">
            {state.message}
          </Notice>
        )}

        {/* STEP 1: Personal Info */}
        <div id="step-0" className={currentStep === 0 ? 'block' : 'hidden'}>
          <Panel title="Personal Information" description="Provide your basic personal details.">
            <div className="grid gap-6 sm:grid-cols-12">
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="salutation">Title</Label>
                <Select name="salutation">
                  <SelectTrigger id="salutation">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Mr.">Mr.</SelectItem>
                    <SelectItem value="Ms.">Ms.</SelectItem>
                    <SelectItem value="Mrs.">Mrs.</SelectItem>
                    <SelectItem value="Dr.">Dr.</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" name="firstName" />
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="middleName">Middle Name</Label>
                <Input id="middleName" name="middleName" />
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" name="lastName" />
              </div>
              
              <div className="space-y-2 sm:col-span-6">
                <Label htmlFor="dob">Date of Birth</Label>
                <Input id="dob" name="dob" type="date" />
              </div>
              <div className="space-y-2 sm:col-span-6">
                <Label htmlFor="nationality">Nationality</Label>
                <Input id="nationality" name="nationality" defaultValue="Indian" />
              </div>

              <div className="space-y-2 sm:col-span-6">
                <Label htmlFor="licenceNo">Aadhaar Number</Label>
                <Input id="licenceNo" name="licenceNo" placeholder="12-digit Aadhaar" minLength={12} maxLength={12} inputMode="numeric" />
              </div>
              <div className="space-y-2 sm:col-span-6">
                <Label htmlFor="panNumber">PAN Number</Label>
                <Input id="panNumber" name="panNumber" placeholder="10-character PAN" maxLength={10} />
              </div>
              
              <div className="space-y-2 sm:col-span-12">
                <Label htmlFor="photo">Upload Photo</Label>
                <Input id="photo" name="photo" type="file" accept="image/*" />
                <p className="text-xs text-text-muted">Max file size: 2MB. Format: JPG, PNG</p>
              </div>
            </div>
          </Panel>
        </div>

        {/* STEP 2: Professional Info */}
        <div id="step-1" className={currentStep === 1 ? 'block' : 'hidden'}>
          <Panel title="Professional Information" description="Provide your professional background and category.">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="professionalType">Professional Category</Label>
                <Select name="professionalType">
                  <SelectTrigger id="professionalType">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {professionalTypes.map(pt => (
                      <SelectItem key={pt.code} value={pt.code}>{pt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="qualification">Qualification</Label>
                <Input id="qualification" name="qualification" placeholder="e.g. B.Arch, B.Tech" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="experienceYears">Total Experience (Years)</Label>
                <Input id="experienceYears" name="experienceYears" type="number" min="0" placeholder="e.g. 5" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="organization">Firm Name (Employed or Self Registered)</Label>
                <Input id="organization" name="organization" placeholder="Name of your firm" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="shortProfile">Short Profile (Experience Summary)</Label>
                <Textarea id="shortProfile" name="shortProfile" placeholder="Brief summary of your professional experience" rows={3} />
              </div>
            </div>
          </Panel>
        </div>

        {/* STEP 3: Contact Info */}
        <div id="step-2" className={currentStep === 2 ? 'block' : 'hidden'}>
          <Panel title="Contact Information" description="Your address and contact details.">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="address">Postal Address</Label>
                <Textarea id="address" name="address" placeholder="Complete postal address" rows={2} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Select name="state" defaultValue="Andhra Pradesh">
                  <SelectTrigger id="state">
                    <SelectValue placeholder="Select State" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Andhra Pradesh">Andhra Pradesh</SelectItem>
                    <SelectItem value="Telangana">Telangana</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="district">City / District</Label>
                <Input id="district" name="district" placeholder="City or District" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pincode">PIN Code</Label>
                <Input id="pincode" name="pincode" placeholder="6-digit PIN" maxLength={6} inputMode="numeric" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mobile">Mobile Number</Label>
                <Input id="mobile" name="mobile" placeholder="10-digit mobile number" maxLength={10} inputMode="numeric" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" name="email" type="email" placeholder="your.email@example.com" />
                <p className="text-xs text-text-muted text-right">Mobile No. & E-mail will be used for notifications.</p>
              </div>
            </div>
          </Panel>
        </div>

        {/* STEP 4: Documents & Login Info */}
        <div id="step-3" className={currentStep === 3 ? 'block' : 'hidden'}>
          <div className="space-y-8">
            <Panel title="Attach Mandatory Documents">
              <Notice tone="info" title="Documents Required">
                You will be prompted to attach your License Certificate, Qualification Proof, ID Proof, Address Proof, and Consent Letter on the next screen or they will be generated automatically for this demo.
              </Notice>
            </Panel>

            <Panel title="Login Information" description="Set up your account credentials.">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="loginName">Login Name</Label>
                  <Input id="loginName" name="loginName" disabled value="(Will use E-mail Address)" className="bg-surface-sunk" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" name="password" type="password" placeholder="Choose a password" minLength={10} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Re-Enter Password</Label>
                  <Input id="confirmPassword" name="confirmPassword" type="password" placeholder="Confirm password" minLength={10} />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="securityQuestion">Security Question</Label>
                  <Select name="securityQuestion">
                    <SelectTrigger id="securityQuestion">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="q1">What is your mother's maiden name?</SelectItem>
                      <SelectItem value="q2">What was the name of your first pet?</SelectItem>
                      <SelectItem value="q3">What city were you born in?</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="securityAnswer">Answer</Label>
                  <Input id="securityAnswer" name="securityAnswer" placeholder="Your answer" />
                </div>
                
                <div className="space-y-2 sm:col-span-2">
                  <Label>Security Captcha</Label>
                  <div className="flex items-center gap-4">
                    <div className="bg-black text-white px-6 py-2 rounded-md font-mono text-xl tracking-widest italic line-through">
                      X9B2K
                    </div>
                    <Input id="captcha" placeholder="Retype characters from picture" className="max-w-xs" />
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Declaration">
              <div className="flex items-start gap-3 space-y-0">
                <Checkbox id="consentGiven" name="consentGiven" value="true" className="mt-1" />
                <Label htmlFor="consentGiven" className="text-body font-normal text-text-muted leading-relaxed">
                  I hereby declare that the information provided above is true and correct to the best of my knowledge.
                  I understand that any false information may lead to rejection of my registration or revocation of my licence.
                </Label>
              </div>
            </Panel>
          </div>
        </div>

        {/* Wizard Controls */}
        <div className="flex justify-between items-center border-t border-border pt-6">
          <Button 
            variant="secondary" 
            type="button" 
            onClick={currentStep === 0 ? () => router.back() : prevStep} 
            disabled={state.status === 'submitting'}
          >
            {currentStep === 0 ? 'Cancel' : (
              <><ChevronLeft className="mr-2 size-4" /> Back</>
            )}
          </Button>
          
          {currentStep < STEPS.length - 1 ? (
            <Button variant="primary" type="button" onClick={nextStep}>
              Continue <ChevronRight className="ml-2 size-4" />
            </Button>
          ) : (
            <Button variant="primary" type="submit" disabled={state.status === 'submitting'}>
              {state.status === 'submitting' ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Registration'
              )}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
