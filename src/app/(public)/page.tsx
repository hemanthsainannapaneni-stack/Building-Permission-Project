import type { Metadata } from 'next';
import { Explore, Highlights, ServiceCards, WhatIsBbas, WhatIsBim } from '@/features/public-portal/home';
import { DemoBanner, Container } from '@/features/public-portal/primitives';

export const metadata: Metadata = { title: { absolute: 'Nirman | Building Permission Portal' } };

/**
 * The public home page — `/`.
 *
 * Previously this route only redirected (to the dashboard, or to sign-in). It
 * is now the front door of the public portal; a signed-in officer or LTP who
 * lands here is offered their workspace from the header, and is no longer
 * bounced away.
 */
export default function PublicHome() {
  return (
    <>
      <Container className="pt-6">
        <DemoBanner />
      </Container>
      <ServiceCards />
      <WhatIsBim />
      <WhatIsBbas />
      <Explore />
      <Highlights />
    </>
  );
}
