'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavItem = { label: string; href: string };

/**
 * The top navigation.
 *
 * A row of links from `md` up and a disclosure below it. The disclosure is a
 * real button with `aria-expanded`/`aria-controls`, closes on Escape and after
 * following a link, and its links stay in the DOM when closed only as far as
 * `hidden` allows — a closed menu is not tabbable.
 */
export function PublicNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => setOpen(false), [pathname]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const isCurrent = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <nav aria-label="Primary" className="bg-primary text-primary-text">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <button
          ref={button}
          type="button"
          className="my-1.5 inline-flex h-10 items-center gap-2 rounded-md px-3 text-body font-semibold hover:bg-white/10 md:hidden"
          aria-expanded={open}
          aria-controls="public-nav-list"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          Menu
        </button>
        <ul
          id="public-nav-list"
          className={cn(
            'w-full flex-col gap-0.5 pb-2 md:flex md:w-auto md:flex-row md:gap-1 md:pb-0',
            open ? 'absolute inset-x-0 top-full z-30 flex bg-primary px-4 shadow-elevated md:static md:bg-transparent md:px-0 md:shadow-none' : 'hidden md:flex'
          )}
        >
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent(item.href) ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-4 py-3 text-body font-semibold transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white md:py-3.5',
                  isCurrent(item.href) && 'bg-white/20 md:border-b-2 md:border-white md:bg-transparent md:rounded-none'
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
