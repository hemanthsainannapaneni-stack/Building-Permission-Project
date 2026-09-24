import { redirect } from 'next/navigation';
import { getAuthUser } from '@/server/auth/context';

export const dynamic = 'force-dynamic';

/**
 * The root sends people where they belong. There is no marketing page here —
 * this is an internal government service, and everyone arriving either has a
 * session or needs one.
 */
export default async function Home() {
  const user = await getAuthUser();
  redirect(user ? '/dashboard' : '/login?session=ended');
}
