'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PageHeader } from '@/components/common/page-header';
import { cn } from '@/lib/utils';
import { Users, Shield, Building2, FileText, Settings2, SlidersHorizontal, MessageSquare, ListChecks } from 'lucide-react';

const TABS = [
  { label: 'Overview', href: '/admin/settings/overview', icon: SlidersHorizontal },
  { label: 'Profile', href: '/admin/settings/profile', icon: Settings2 },
  { label: 'Users', href: '/admin/settings/users', icon: Users },
  { label: 'Roles', href: '/admin/settings/roles', icon: Shield },
  { label: 'Organisation', href: '/admin/settings/organisation', icon: Building2 },
  { label: 'Document Types', href: '/admin/settings/document-types', icon: FileText },
  { label: 'Checklists', href: '/admin/settings/checklists', icon: ListChecks },
  { label: 'NOC Types', href: '/admin/settings/noc-types', icon: FileText },
  { label: 'Professional Types', href: '/admin/settings/professional-types', icon: FileText },
  { label: 'System', href: '/admin/settings/system', icon: SlidersHorizontal },
  { label: 'Notifications', href: '/admin/settings/notifications', icon: MessageSquare },
  { label: 'Delivery Logs', href: '/admin/settings/sms-logs', icon: MessageSquare },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // If we are deep inside a route (e.g. /admin/settings/users/[id]), 
  // we still highlight the base tab.
  const activeTab = TABS.find((tab) => pathname === tab.href || pathname.startsWith(tab.href + '/'))?.href;

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Settings" />
      
      <div className="px-6">
        <div className="border-b border-border">
          <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.href;
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-text-muted hover:border-gray-300 hover:text-text',
                    'group inline-flex items-center border-b-2 py-4 px-1 text-sm font-medium whitespace-nowrap'
                  )}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon
                    className={cn(
                      isActive ? 'text-primary' : 'text-text-subtle group-hover:text-text-muted',
                      '-ml-0.5 mr-2 h-5 w-5'
                    )}
                    aria-hidden="true"
                  />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
