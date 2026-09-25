import { professionalTypes } from '@/server/services/professional-registrations';
import { PageFrame } from '@/features/public-portal/primitives';
import { LtpRegisterForm } from '@/features/public-portal/ltp-register-form';

export const metadata = {
  title: 'LTP Registration',
};

export default async function LtpRegistrationPage() {
  const pTypes = await professionalTypes({ activeOnly: true });

  return (
    <PageFrame
      title="Licensed Technical Person (LTP) Registration"
      intro="Apply to be registered as a Licensed Technical Person. Please fill in the following details."
      crumbs={[{ label: 'LTP', href: '/public/ltp' }]}
      back={{ label: 'LTP Services', href: '/public/ltp' }}
      demo={true}
    >
      <div className="mx-auto max-w-4xl">
        <LtpRegisterForm professionalTypes={pTypes} />
      </div>
    </PageFrame>
  );
}
