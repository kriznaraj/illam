import type { LucideIcon } from 'lucide-react';
import {
  BarChart2, BookOpen, CalendarClock, Camera, CheckSquare, CreditCard, FileText, Home,
  Landmark, LayoutDashboard, Mail, PieChart, ReceiptIndianRupee, Scale, Search, Settings,
  ShieldCheck, Tag, TrendingUp, Wallet,
} from 'lucide-react';

/** One place for the app's sections, so the header, bottom bar and home tiles agree. */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** One line on what the section is for (home tiles). */
  hint?: string;
  /** In a tab row, show only the icon (the label stays for screen readers). */
  iconOnly?: boolean;
}

export const HOME: NavItem = { href: '/home', label: 'Home', icon: Home };
export const EXPENSES: NavItem = { href: '/expenses', label: 'Expenses', icon: ReceiptIndianRupee, hint: 'Spending, income and reports' };
export const NET_WORTH: NavItem = { href: '/portfolio', label: 'Net worth', icon: TrendingUp, hint: 'Accounts, investments and cards' };
export const INBOX: NavItem = { href: '/inbox', label: 'Inbox', icon: Mail, hint: 'Bank mail turned into records' };
export const CASH_FLOW: NavItem = { href: '/cash-flow', label: 'Cash flow', icon: Scale, hint: 'Money in against money out' };

/** Smaller tools, under "More". */
export const MORE_ITEMS: NavItem[] = [
  { href: '/notes', label: 'Notes', icon: FileText, hint: 'Shared household notes' },
  { href: '/todos', label: 'To-dos', icon: CheckSquare, hint: 'Shared tasks' },
  { href: '/activity-tracker', label: 'Activity tracker', icon: CalendarClock, hint: 'Milestones, habits and dates' },
  { href: '/annual-review', label: 'Annual review', icon: BookOpen, hint: 'Twelve months on one page' },
];

/**
 * Tabs inside each section. Rows stay short (four or five words) so they fit a 360px phone
 * without scrolling; related views share one tab and switch inside the page.
 */
export const EXPENSE_TABS: NavItem[] = [
  { href: '/expenses', label: 'Overview', icon: LayoutDashboard },
  { href: '/expenses/browse', label: 'Browse', icon: Search },
  { href: '/expenses/report', label: 'Reports', icon: BarChart2 },
  { href: '/expenses/organize', label: 'Organize', icon: Tag },
];

export const NET_WORTH_TABS: NavItem[] = [
  { href: '/portfolio', label: 'Overview', icon: PieChart },
  { href: '/portfolio/snapshots', label: 'Snapshots', icon: Camera },
  { href: '/portfolio/investments', label: 'Invest', icon: Landmark },
  { href: '/portfolio/credit-cards', label: 'Cards', icon: CreditCard },
  { href: '/portfolio/report', label: 'Reports', icon: BarChart2 },
  { href: '/portfolio/settings', label: 'Settings', icon: Settings, iconOnly: true },
];

export const CASH_FLOW_TABS: NavItem[] = [
  { href: '/cash-flow', label: 'Overview', icon: Scale },
  { href: '/cash-flow/income', label: 'Income', icon: Wallet },
  { href: '/cash-flow/commitments', label: 'Insurance & EMIs', icon: ShieldCheck },
];

/** Pages that belong to another tab: they light that tab up. */
const TAB_ALIASES: Record<string, string[]> = {
  '/expenses/report': ['/expenses/insights', '/expenses/reports'],
  '/portfolio/report': ['/portfolio/insights'],
  // SIP and gold are managed from Net worth settings, though their routes sit beside it.
  '/portfolio/settings': ['/portfolio/sip', '/portfolio/gold'],
};

export type Section = 'home' | 'expenses' | 'net-worth' | 'inbox' | 'cash-flow' | 'other';

export function sectionFor(pathname: string): Section {
  if (pathname === '/' || pathname === '/home') return 'home';
  if (pathname.startsWith('/expenses')) return 'expenses';
  if (pathname.startsWith('/portfolio')) return 'net-worth';
  if (pathname.startsWith('/inbox')) return 'inbox';
  if (pathname.startsWith('/cash-flow')) return 'cash-flow';
  return 'other';
}

/** Whether a tab is the current one. Section roots only match exactly. */
export function isTabActive(href: string, pathname: string): boolean {
  const under = (base: string) => pathname === base || pathname.startsWith(base + '/');
  if (pathname === href) return true;
  if (TAB_ALIASES[href]?.some(under)) return true;
  if (href === '/portfolio' || href === '/expenses' || href === '/cash-flow') return false;
  return under(href);
}
