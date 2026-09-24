import {
  LayoutDashboard,
  FileText,
  ListChecks,
  AlertTriangle,
  MapPin,
  FileBadge2,
  FileWarning,
  Gavel,
  Send,
  UserRoundCog,
  HardHat,
  Building2,
  CreditCard,
  FolderOpen,
  SlidersHorizontal,
  LineChart,
  type LucideIcon,
} from 'lucide-react';
import { CAPABILITIES as C, type Capability } from './constants';

/**
 * The sidebar, as data.
 *
 * Every entry declares the capability it needs. `visibleNav()` filters the
 * tree, so a role never sees a link it cannot follow — which is the whole
 * point: a nav item that 403s is a bug the user experiences as the product
 * being broken.
 *
 * This filtering is CHROME ONLY. It decides what is shown, never what is
 * permitted. The server re-derives permission on every request regardless.
 */

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Any one of these grants visibility. */
  capabilities?: Capability[];
  /** Rendered but not yet built — the phase that delivers it. */
  comingIn?: string;
};

export type NavSection = {
  label?: string;
  items: NavItem[];
};

export const NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      {
        label: 'Applications',
        href: '/applications',
        icon: FileText,
        capabilities: [C.APPLICATION_VIEW],
      },
      {
        label: 'Tasks',
        href: '/tasks',
        icon: ListChecks,
        capabilities: [C.WORKFLOW_VIEW],
      },
      {
        label: 'Shortfalls',
        href: '/shortfalls',
        icon: AlertTriangle,
        capabilities: [C.SHORTFALL_VIEW],
      },
      {
        label: 'Site Inspections',
        href: '/inspections',
        icon: MapPin,
        capabilities: [C.SITE_INSPECTION_VIEW],
      },
      {
        label: 'NOCs',
        href: '/nocs',
        icon: FileBadge2,
        capabilities: [C.NOC_VIEW],
      },
      {
        label: 'Show Cause',
        href: '/show-cause',
        icon: FileWarning,
        capabilities: [C.SHOW_CAUSE_VIEW],
      },
      {
        label: 'Revoke Proceedings',
        href: '/revocations',
        icon: Gavel,
        capabilities: [C.REVOCATION_VIEW],
      },
      {
        label: 'Change of Professional',
        href: '/professional-changes',
        icon: UserRoundCog,
        capabilities: [C.PROFESSIONAL_CHANGE_VIEW],
      },
      {
        label: 'Work Initiated',
        href: '/work-initiated',
        icon: HardHat,
        capabilities: [C.COMMENCEMENT_VIEW],
      },
      {
        label: 'Occupancy',
        href: '/occupancy',
        icon: Building2,
        capabilities: [C.OCCUPANCY_VIEW],
      },
      {
        label: 'Outward',
        href: '/outward',
        icon: Send,
        capabilities: [C.OUTWARD_VIEW],
      },
      {
        label: 'Payments',
        href: '/payments',
        icon: CreditCard,
        capabilities: [C.PAYMENT_VIEW],
      },
      {
        label: 'Documents',
        href: '/documents',
        icon: FolderOpen,
        capabilities: [C.DOCUMENT_VIEW],
      },
      {
        label: 'Reports',
        href: '/reports',
        icon: LineChart,
        capabilities: [C.APPLICATION_VIEW],
      },
      {
        label: 'Settings',
        href: '/admin/settings',
        icon: SlidersHorizontal,
        capabilities: [C.SETTINGS_MANAGE, C.USER_MANAGE, C.ROLE_MANAGE, C.ORG_MANAGE, C.MASTER_DATA_MANAGE],
      },
    ],
  },
];

/** Filters the tree to what this user may actually reach. */
export function visibleNav(capabilities: string[]): NavSection[] {
  const can = (item: NavItem) =>
    !item.capabilities?.length || item.capabilities.some((c) => capabilities.includes(c));

  return NAV.map((section) => ({ ...section, items: section.items.filter(can) })).filter(
    (section) => section.items.length > 0
  );
}

/** Breadcrumb labels for path segments that are not self-explanatory. */
const SEGMENT_LABELS: Record<string, string> = {
  admin: 'Administration',
  users: 'Users',
  roles: 'Roles',
  organisation: 'Organisation',
  settings: 'Settings',
  audit: 'Audit log',
  dashboard: 'Dashboard',
  applications: 'Applications',
  tasks: 'Tasks',
  shortfalls: 'Shortfalls',
  inspections: 'Site Inspections',
  nocs: 'NOCs',
  'show-cause': 'Show Cause',
  revocations: 'Revoke Proceedings',
  outward: 'Outward Register',
  'professional-changes': 'Change of Professional',
  'work-initiated': 'Work Initiated',
  occupancy: 'Occupancy',
  payments: 'Payments',
  documents: 'Documents',
  notifications: 'Notification Center',
  logs: 'Delivery Logs',
  reports: 'Reports',
  analytics: 'Analytics',
  profile: 'Profile',
  new: 'New',
};

export function breadcrumbsFor(pathname: string): Array<{ label: string; href: string }> {
  const segments = pathname.split('/').filter(Boolean);

  return segments.map((segment, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/');
    const label =
      SEGMENT_LABELS[segment] ??
      // A UUID segment is a record id, not a page name.
      (/^[0-9a-f-]{20,}$/i.test(segment)
        ? 'Details'
        : segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' '));
    return { label, href };
  });
}
