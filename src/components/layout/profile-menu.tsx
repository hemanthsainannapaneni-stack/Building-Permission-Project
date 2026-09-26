'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut, User as UserIcon, KeyRound, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initials } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';

export function ProfileMenu({
  name,
  email,
  roleNames,
}: {
  name: string;
  email: string;
  roleNames: string[];
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      // A hard navigation, not router.push: it discards every cached server
      // component so the next user of this browser cannot see the last one's
      // rendered pages.
      window.location.href = '/';
    } catch {
      setSigningOut(false);
      toast.error('Could not sign out', {
        description: 'Check your connection and try again.',
      });
      router.refresh();
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-full p-0.5 transition-all hover:ring-2 hover:ring-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`Account menu for ${name}`}
        >
          <Avatar className="size-8.5 rounded-full border border-border shadow-subtle">
            <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-semibold text-caption">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72 rounded-xl p-2 shadow-elevated border border-border/80">
        <DropdownMenuLabel className="p-2 pb-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar className="size-9 shrink-0 rounded-full border border-border">
              <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-semibold text-small">
                {initials(name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-small font-bold text-text">{name}</p>
              <p className="truncate text-caption text-text-muted">{email}</p>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1">
            {roleNames.map((role) => (
              <Badge key={role} tone="info">
                {role}
              </Badge>
            ))}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="my-1" />

        <DropdownMenuItem asChild className="rounded-lg p-2 text-small font-medium cursor-pointer">
          <Link href="/admin/settings/profile">
            <UserIcon className="size-4 text-text-muted" />
            Profile settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild className="rounded-lg p-2 text-small font-medium cursor-pointer">
          <Link href="/admin/settings/profile?changePassword=1">
            <KeyRound className="size-4 text-text-muted" />
            Change password
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-1" />

        <DropdownMenuItem
          destructive
          onSelect={(e) => { e.preventDefault(); void signOut(); }}
          className="rounded-lg p-2 text-small font-medium cursor-pointer text-danger focus:bg-danger-bg focus:text-danger"
        >
          {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
