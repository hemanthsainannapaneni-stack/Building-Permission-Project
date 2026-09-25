import type { Metadata } from 'next';
import { getAuthUser } from '@/server/auth/context';
import { env } from '@/server/config/env';
import { PublicShell } from '@/features/public-portal/shell';

/**
 * The public portal's route group. Every page in it renders inside
 * `PublicShell`; none of them uses the workspace's `AppShell`, so a visitor
 * never meets a sidebar, a notification bell or a persona switcher.
 *
 * Which URLs are open to a visitor with no session is decided by the
 * middleware (`/` and `/public/*`), not by this file — being in this group
 * grants nothing.
 */
export const metadata: Metadata = {
  title: { default: 'Nirman | Building Permission Portal', template: 'Nirman | %s' },
  description: 'A BBAS-style building permission demonstration: track applications and fees, register and renew developers and LTPs, and browse the public registers.',
};

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();
  return <PublicShell appName={env.appName} isSignedIn={Boolean(user)}>{children}</PublicShell>;
}
