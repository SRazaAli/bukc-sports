/**
 * Sidebar navigation — which pages each role can open.
 *
 * Same routes, same per-role conditions and same order as the previous home
 * screen's feature cards (HomeScreen.getFeatures), now grouped into sidebar
 * sections. The server is still the security gate; this only decides which
 * links a role is shown.
 */
import type { ReactNode } from 'react';
import type { UserRole } from '../lib/auth.js';

export type NavSection = 'Account' | 'Equipment' | 'Venues' | 'Records';

export interface NavItem {
  key: string;
  label: string;
  to: string;
  section: NavSection;
  icon: ReactNode;
  /** Other route prefixes that belong to this item (keeps it highlighted on sub-pages). */
  alsoActiveOn?: string[];
}

export const SECTION_ORDER: NavSection[] = ['Account', 'Equipment', 'Venues', 'Records'];

export const ROLE_LABEL: Record<UserRole, string> = {
  STUDENT: 'Student',
  EXTERNAL: 'External',
  COORDINATOR: 'Coordinator',
  SUPER_ADMIN: 'Administration Staff',
};

export function getNavItems(role: UserRole): NavItem[] {
  const items: NavItem[] = [];
  const push = (i: NavItem) => items.push(i);

  push({ key: 'profile', label: 'My Profile', to: '/profile', section: 'Account', icon: <ProfileIcon /> });

  if (role === 'SUPER_ADMIN') {
    push({ key: 'dashboard', label: 'Admin Dashboard', to: '/dashboard', section: 'Account', icon: <DashboardIcon /> });
    push({ key: 'manage-accounts', label: 'Manage Accounts', to: '/admin/accounts', section: 'Account', icon: <PeopleIcon /> });
  }
  if (role === 'COORDINATOR') {
    push({ key: 'view-accounts', label: 'View Accounts', to: '/admin/accounts', section: 'Account', icon: <EyeIcon /> });
  }
  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'inventory', label: 'Inventory', to: '/inventory', section: 'Equipment', icon: <BoxIcon /> });
  }

  push({
    key: 'availability', label: 'Equipment Availability', to: '/availability', section: 'Equipment', icon: <ToolIcon />,
    // Borrowing an item and "My Borrows" are opened from the availability page.
    alsoActiveOn: ['/borrow/', '/my-borrows'],
  });

  if (role === 'COORDINATOR') {
    push({ key: 'borrow-queue', label: 'Borrow Queue', to: '/borrow-queue', section: 'Equipment', icon: <QueueIcon /> });
  }
  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'active-borrows', label: 'Active Borrows', to: '/active-borrows', section: 'Equipment', icon: <ClipboardIcon /> });
  }
  if (role === 'STUDENT' || role === 'EXTERNAL') {
    push({ key: 'book-venue', label: 'Book a Venue', to: '/book-venue', section: 'Venues', icon: <PinIcon /> });
  }
  if (role === 'COORDINATOR') {
    push({ key: 'venue-queue', label: 'Venue Queue', to: '/venue-queue', section: 'Venues', icon: <QueueIcon /> });
    push({ key: 'equipment-alerts', label: 'Equipment Alerts', to: '/equipment-alerts', section: 'Equipment', icon: <BellIcon /> });
  }
  if (role === 'SUPER_ADMIN') {
    push({ key: 'venue-approvals', label: 'Venue Approvals', to: '/venue-approvals', section: 'Venues', icon: <ShieldCheckIcon /> });
  }
  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'conflict-detection', label: 'Conflict Detection', to: '/conflict-detection', section: 'Venues', icon: <AlertIcon /> });
  }

  push({ key: 'calendar', label: 'Calendar', to: '/calendar', section: 'Venues', icon: <CalendarIcon /> });
  push({ key: 'usage-history', label: 'Usage History', to: '/usage-history', section: 'Records', icon: <HistoryIcon /> });

  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'offline-fallback', label: 'Offline Fallback Entry', to: '/offline-fallback', section: 'Records', icon: <WifiOffIcon /> });
  }

  return items;
}

/** Items grouped by section, in sidebar order, skipping empty sections. */
export function groupNavItems(items: NavItem[]): Array<{ section: NavSection; items: NavItem[] }> {
  return SECTION_ORDER
    .map((section) => ({ section, items: items.filter((i) => i.section === section) }))
    .filter((g) => g.items.length > 0);
}

export function isItemActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.to || pathname.startsWith(item.to + '/')) return true;
  return (item.alsoActiveOn ?? []).some((p) => pathname === p || pathname.startsWith(p));
}

/* ---------- icons (same drawings as the previous home screen) ---------- */
const sz = 20;
function ProfileIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.6"/><path d="M5 20c1-3.5 4-5.5 7-5.5s6 2 7 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function DashboardIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.6"/><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.4" stroke="currentColor" strokeWidth="1.6"/><rect x="13.5" y="10.5" width="7" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.6"/><rect x="3.5" y="13" width="7" height="7.5" rx="1.4" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function PeopleIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6"/><path d="M3 20c.8-3.2 3-5 6-5s5.2 1.8 6 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="17" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.5"/><path d="M15.5 12.2c2.4.3 4 1.8 4.5 4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>; }
function EyeIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function BoxIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M3.7 7.6 12 11.5l8.3-3.9M12 11.5v9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>; }
function ToolIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M14.7 6.3a3.6 3.6 0 0 1-4.9 4.4L4.5 16l1.9 1.9 5.4-5.3a3.6 3.6 0 0 1 4.4-4.9l-1.9 1.9-1.6-1.6 1.9-1.9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>; }
function QueueIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 6.5h16M4 12h16M4 17.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function ClipboardIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><rect x="5" y="4.5" width="14" height="16" rx="1.6" stroke="currentColor" strokeWidth="1.6"/><rect x="8.5" y="3" width="7" height="3" rx="1" stroke="currentColor" strokeWidth="1.6"/><path d="M8.5 11.5h7M8.5 15.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function PinIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 21s7-6.4 7-11.5a7 7 0 1 0-14 0C5 14.6 12 21 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="12" cy="9.3" r="2.4" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function BellIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 16V10a6 6 0 0 1 12 0v6l1.6 2.3H4.4L6 16z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9.5 20.5a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function ShieldCheckIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 3.5l7 2.8v6c0 4.6-3 7.8-7 9.2-4-1.4-7-4.6-7-9.2v-6l7-2.8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9 12l2 2 4-4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function AlertIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 3.5 21.5 20h-19L12 3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M12 10v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="12" cy="17" r="0.9" fill="currentColor"/></svg>; }
function CalendarIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><rect x="4" y="5.5" width="16" height="14.5" rx="1.8" stroke="currentColor" strokeWidth="1.6"/><path d="M4 9.5h16M8 3.5v4M16 3.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function HistoryIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="13" r="7.5" stroke="currentColor" strokeWidth="1.6"/><path d="M12 9v4.2l3 1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M8.5 3.5A9.6 9.6 0 0 0 4.3 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function WifiOffIcon() { return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M3 8.5c2.6-2.2 6-3.3 9-3.3M21 8.5c-1.3-1.1-2.8-1.9-4.4-2.5M6.5 12.3c1.6-1.2 3.5-1.8 5.5-1.8M17.5 12.3a9 9 0 0 0-2-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M9.8 16a4.8 4.8 0 0 1 4.4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="12" cy="19" r="1" fill="currentColor"/><path d="M2.5 3 21.5 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
