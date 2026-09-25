import { redirect } from 'next/navigation';

/** `/public` is the namespace, not a page: it lands on the portal's home. */
export default function PublicIndex() {
  redirect('/');
}
