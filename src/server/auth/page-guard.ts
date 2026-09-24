import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getAuthUser, can, type AuthUser } from './context';
import type { Capability } from '@/lib/constants';

/**
 * Server-side page guards — the SECOND gate, and the one that actually
 * decides.
 *
 * Edge middleware only checks that a cookie exists; it has no database and so
 * cannot re-read role or account status. These run in the Node runtime during
 * server rendering, where the real user can be resolved.
 *
 * Every protected page calls one of these. A page that forgets to is a page
 * that leaks, so there is no "optional" variant that silently returns null for
 * a signed-out visitor.
 */

export type PageUser = AuthUser & { roleNames: string[] };

/**
 * Resolves the user or redirects to sign in.
 *
 * Wrapped with React.cache() so that the portal layout and the page
 * receive the same resolved object without a second round of DB queries.
 */
export const requirePageUser = cache(async function requirePageUser(): Promise<PageUser> {
  const user = await getAuthUser();
  // `session=ended` tells the middleware to clear the cookies: a token whose
  // session is gone still verifies at the edge and would otherwise loop.
  if (!user) redirect('/login?session=ended');
  return user as PageUser;
});

/**
 * Resolves the user and asserts a capability, or sends them to /unauthorized.
 *
 * Deliberately a redirect rather than a 404: the person is legitimately signed
 * in and needs to understand that their ROLE is the limit, not that the page
 * is missing.
 */
export async function requirePageCapability(...capabilities: Capability[]): Promise<PageUser> {
  const user = await requirePageUser();
  if (!can(user, ...capabilities)) redirect('/unauthorized');
  return user;
}
