'use client';

import * as React from 'react';
import { ChevronRight, ChevronLeft, Menu } from 'lucide-react';
import { Sidebar } from './sidebar';
import { GlobalSearch } from './global-search';
import { NotificationBell } from './notification-bell';
import { ProfileMenu } from './profile-menu';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { QuickPersonaSwitcher } from './quick-persona-switcher';

export type ShellUser = {
  name: string;
  email: string;
  capabilities: string[];
  roleNames: string[];
};

/**
 * The authenticated frame.
 *
 * Responsive by structure rather than by hiding things: the sidebar is a
 * permanent rail from `lg` up and a drawer below it, so a phone gets the same
 * navigation rather than a reduced one.
 */
export function AppShell({
  user,
  demoMode: _demoMode,
  children,
}: {
  user: ShellUser;
  demoMode?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const firstName = user.name.split(' ')[0] || 'User';
  const greeting = `Good ${timeOfDay.toLowerCase()}, ${firstName}`;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen bg-bg">
        {/* Permanent rail, large screens up. */}
        <aside className={cn('hidden lg:block shrink-0 transition-all duration-300 relative', collapsed ? 'w-16' : 'w-64')}>
          <div className={cn('fixed inset-y-0 left-0 z-30 transition-all duration-300', collapsed ? 'w-16' : 'w-64')}>
            <Sidebar capabilities={user.capabilities} collapsed={collapsed} />

            <Button
              variant="secondary"
              size="icon"
              className="absolute -right-3 top-1/2 -translate-y-1/2 z-40 hidden lg:flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-text-muted shadow-sm hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
            </Button>
          </div>
        </aside>

        {/* Drawer, below large. */}
        <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
          <DrawerContent side="left" className="w-64 max-w-[80vw] p-0 border-r border-border">
            <DrawerTitle className="sr-only">Navigation</DrawerTitle>
            <Sidebar capabilities={user.capabilities} onNavigate={() => setMobileOpen(false)} />
          </DrawerContent>
        </Drawer>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/80 bg-surface/85 px-1 sm:px-2 backdrop-blur-md shadow-subtle transition-colors">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>



            <div className="hidden min-w-0 sm:block">
              <span className="text-sm font-medium text-text">{greeting}</span>
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <GlobalSearch />
              <QuickPersonaSwitcher currentEmail={user.email} />
              <NotificationBell />
              <ProfileMenu name={user.name} email={user.email} roleNames={user.roleNames} />
            </div>
          </header>

          <main className="min-w-0 flex-1 px-1 py-3.5 sm:px-2">
            <div className="w-full">{children}</div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
