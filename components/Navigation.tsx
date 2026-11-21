'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { classNames } from '@/lib/utils';
import { useState, lazy, Suspense } from 'react';
import { IllamBrand } from './IllamLogo';
import { clearAllCache } from '@/lib/useClientCache';
import {
  Home, Receipt, TrendingUp, FileText, CheckSquare,
  Settings, LogOut, User, ChevronDown, MoreHorizontal, Plus,
  LayoutDashboard, Search, Lightbulb, BarChart2, Tag,
  PieChart, Camera, CreditCard, RefreshCw, CalendarClock, Bug, Landmark, BookOpen, Mail, Wallet, Scale,
} from 'lucide-react';
import { PWAInstallMenuItem } from './PWAInstallMenuItem';
import { useInboxAttention } from '@/lib/hooks/useInbox';

// Lazy load QuickAddExpense modal
const QuickAddExpense = lazy(() => import('./QuickAddExpense'));

type Module = 'home' | 'expenses' | 'portfolio' | 'other';

const SETTINGS_SUBROUTES = ['/portfolio/sip', '/portfolio/gold'];

function isNavActive(href: string, pathname: string): boolean {
  if (pathname === href) return true;
  if (href === '/portfolio/settings' && (pathname.startsWith('/portfolio/settings') || SETTINGS_SUBROUTES.some((r) => pathname.startsWith(r)))) return true;
  if (href !== '/portfolio' && href !== '/expenses') return pathname.startsWith(href + '/');
  return false;
}

const expenseNavItems = [
  { href: '/expenses',          label: 'Dashboard', icon: <LayoutDashboard size={15} /> },
  { href: '/expenses/browse',   label: 'Browse',    icon: <Search          size={15} /> },
  { href: '/expenses/income',   label: 'Income',    icon: <Wallet          size={15} /> },
  { href: '/expenses/insights', label: 'Insights',  icon: <Lightbulb       size={15} /> },
  { href: '/expenses/report',   label: 'Report',    icon: <BarChart2       size={15} /> },
  { href: '/expenses/organize', label: 'Organize',  icon: <Tag             size={15} /> },
];

const portfolioNavItems = [
  { href: '/portfolio',           label: 'Dashboard', icon: <PieChart        size={15} /> },
  { href: '/portfolio/investments', label: 'Invest',  icon: <Landmark        size={15} /> },
  { href: '/portfolio/insights',  label: 'Insights',  icon: <Lightbulb       size={15} /> },
  { href: '/portfolio/snapshots', label: 'Snapshots', icon: <Camera          size={15} /> },
  { href: '/portfolio/report',    label: 'Report',    icon: <BarChart2       size={15} /> },
  { href: '/portfolio/credit-cards', label: 'Cards', icon: <CreditCard size={15} /> },
  { href: '/portfolio/settings',  label: 'Settings',  icon: <Settings        size={15} /> },
];

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, logout } = useAuth();
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Same cache key as the /home card, so both share one request.
  const { count: inboxCount } = useInboxAttention(3, pathname !== '/login');

  const inboxLink = (
    <Link
      href="/inbox"
      className="icon-button-sm hover:bg-gray-100 relative"
      title="Madal"
      aria-label={inboxCount > 0 ? `Madal, ${inboxCount} waiting on you` : 'Madal'}
    >
      <Mail size={18} className="text-gray-500" />
      {inboxCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-4 text-center">
          {inboxCount > 9 ? '9+' : inboxCount}
        </span>
      )}
    </Link>
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    clearAllCache();
    router.refresh();

    // Show visual feedback for at least 500ms
    setTimeout(() => {
      setIsRefreshing(false);
      // Dispatch custom event to trigger refetch in hooks
      window.dispatchEvent(new CustomEvent('cacheCleared'));
    }, 500);
  };

  const activeModule: Module = pathname.startsWith('/expenses')
    ? 'expenses'
    : pathname.startsWith('/portfolio')
    ? 'portfolio'
    : pathname === '/home' || pathname === '/'
    ? 'home'
    : 'other';

  if (pathname === '/login') return null;

  const subNavItems = activeModule === 'expenses'
    ? expenseNavItems
    : activeModule === 'portfolio'
    ? portfolioNavItems
    : [];

  const activeColor = activeModule === 'expenses' ? 'blue' : 'green';

  return (
    <>
      {/* ─── DESKTOP NAV ─── */}
      <nav className="hidden md:block bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Top row */}
          <div className="flex justify-between h-16 border-b border-gray-100">
            <div className="flex items-center space-x-8">
              <Link href="/home" className="flex items-center" aria-label="Illam home">
                <IllamBrand size={34} />
              </Link>

              <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
                <Link href="/home" className={classNames('flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all', activeModule === 'home' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900')}>
                  <Home size={15} /> Illam
                </Link>
                <Link href="/expenses" className={classNames('flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all', activeModule === 'expenses' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900')}>
                  <Receipt size={15} /> Selavu
                </Link>
                <Link href="/portfolio" className={classNames('flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all', activeModule === 'portfolio' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900')}>
                  <TrendingUp size={15} /> Selvam
                </Link>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {inboxLink}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="icon-button-sm hover:bg-gray-100 disabled:opacity-50"
                title="Refresh data"
              >
                <RefreshCw
                  size={18}
                  className={classNames(
                    'text-gray-500',
                    isRefreshing && 'animate-spin'
                  )}
                />
              </button>
              <div className="relative">
                <button onClick={() => setShowUserMenu(!showUserMenu)} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors">
                  <User size={16} className="text-gray-500" />
                  <span className="text-sm font-semibold text-gray-900">{currentUser?.full_name}</span>
                  <ChevronDown size={13} className="text-gray-400" />
                </button>
                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                      <Link href="/notes" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowUserMenu(false)}>
                        <FileText size={15} className="text-gray-400" /><span>Kurippu</span>
                      </Link>
                      <Link href="/todos" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowUserMenu(false)}>
                        <CheckSquare size={15} className="text-gray-400" /><span>Seyal</span>
                      </Link>
                      <Link href="/activity-tracker" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowUserMenu(false)}>
                        <CalendarClock size={15} className="text-gray-400" /><span>Activity Tracker</span>
                      </Link>
                      <Link href="/cash-flow" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowUserMenu(false)}>
                        <Scale size={15} className="text-gray-400" /><span>Cash flow</span>
                      </Link>
                      <div className="border-t border-gray-100 my-1" />
                      <Link href="/account" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowUserMenu(false)}>
                        <Settings size={15} className="text-gray-400" /><span>Account</span>
                      </Link>
                      <Link href="/debug" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowUserMenu(false)}>
                        <Bug size={15} className="text-gray-400" /><span>Debug Logs</span>
                      </Link>
                      <PWAInstallMenuItem onClick={() => setShowUserMenu(false)} />
                      <div className="border-t border-gray-100 my-1" />
                      <button onClick={() => { setShowUserMenu(false); logout(); }} className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                        <LogOut size={15} /><span>Logout</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Sub-nav row */}
          {subNavItems.length > 0 && (
            <div className="flex items-center space-x-1 h-12">
              {subNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={classNames(
                    'flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                    isNavActive(item.href, pathname)
                      ? activeColor === 'blue' ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-green-50 text-green-700 font-semibold'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )}
                >
                  {item.icon}{item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* ─── MOBILE TOP BAR ─── */}
      <div className="md:hidden bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="px-4 py-3 flex justify-between items-center">
          <Link href="/home" className="flex items-center" aria-label="Illam home">
            <IllamBrand size={30} />
          </Link>
          <div className="flex items-center gap-2">
            {inboxLink}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="icon-button-sm hover:bg-gray-100 disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw
                size={18}
                className={classNames(
                  'text-gray-500',
                  isRefreshing && 'animate-spin'
                )}
              />
            </button>
            <div className="flex items-center gap-1.5 px-2 py-1">
              <User size={14} className="text-gray-400" />
              <span className="text-xs font-semibold text-gray-900">{currentUser?.full_name}</span>
            </div>
          </div>
        </div>

        {/* Mobile sub-tabs */}
        {subNavItems.length > 0 && (
          <div className="flex border-t border-gray-100">
            {subNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={classNames(
                  'flex-1 flex items-center justify-center py-2.5 border-b-2 transition-colors',
                  isNavActive(item.href, pathname)
                    ? activeColor === 'blue' ? 'border-blue-600 text-blue-600' : 'border-green-600 text-green-600'
                    : 'border-transparent text-gray-400'
                )}
                title={item.label}
              >
                {item.icon}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ─── MOBILE BOTTOM NAV ─── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
        <div className="flex h-16">
          <Link href="/home" className={classNames('flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors', activeModule === 'home' ? 'text-gray-900' : 'text-gray-400')}>
            <Home size={22} />
            <span className="text-[10px] font-medium">Illam</span>
          </Link>
          <Link href="/expenses" className={classNames('flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors', activeModule === 'expenses' ? 'text-blue-600' : 'text-gray-400')}>
            <Receipt size={22} />
            <span className="text-[10px] font-medium">Selavu</span>
          </Link>
          <Link href="/portfolio" className={classNames('flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors', activeModule === 'portfolio' ? 'text-green-600' : 'text-gray-400')}>
            <TrendingUp size={22} />
            <span className="text-[10px] font-medium">Selvam</span>
          </Link>
          <button
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            className={classNames('flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors', showMoreMenu ? 'text-purple-600' : 'text-gray-400')}
          >
            <MoreHorizontal size={22} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* More Menu Popup */}
      {showMoreMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
          <div className="md:hidden fixed bottom-16 right-0 w-48 bg-white rounded-tl-2xl shadow-xl border border-gray-200 z-50 overflow-hidden">
            <Link href="/inbox" className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100" onClick={() => setShowMoreMenu(false)}>
              <Mail size={16} className="text-gray-400" /><span className="font-medium">Madal</span>
              {inboxCount > 0 && <span className="ml-auto px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold leading-4">{inboxCount}</span>}
            </Link>
            <Link href="/notes" className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100" onClick={() => setShowMoreMenu(false)}>
              <FileText size={16} className="text-gray-400" /><span className="font-medium">Kurippu</span>
            </Link>
            <Link href="/todos" className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100" onClick={() => setShowMoreMenu(false)}>
              <CheckSquare size={16} className="text-gray-400" /><span className="font-medium">Seyal</span>
            </Link>
            <Link href="/activity-tracker" className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100" onClick={() => setShowMoreMenu(false)}>
              <CalendarClock size={16} className="text-gray-400" /><span className="font-medium">Activity Tracker</span>
            </Link>
            <Link href="/annual-review" className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100" onClick={() => setShowMoreMenu(false)}>
              <BookOpen size={16} className="text-gray-400" /><span className="font-medium">Annual Review</span>
            </Link>
            <Link href="/cash-flow" className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100" onClick={() => setShowMoreMenu(false)}>
              <Scale size={16} className="text-gray-400" /><span className="font-medium">Cash flow</span>
            </Link>
            <Link href="/account" className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100" onClick={() => setShowMoreMenu(false)}>
              <Settings size={16} className="text-gray-400" /><span className="font-medium">Account</span>
            </Link>
            <Link href="/debug" className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100" onClick={() => setShowMoreMenu(false)}>
              <Bug size={16} className="text-gray-400" /><span className="font-medium">Debug Logs</span>
            </Link>
            <PWAInstallMenuItem
              onClick={() => setShowMoreMenu(false)}
              className="flex items-center gap-3 w-full px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100"
            />
            <button onClick={() => { setShowMoreMenu(false); logout(); }} className="flex items-center gap-3 w-full px-4 py-3.5 text-sm text-red-600 hover:bg-red-50">
              <LogOut size={16} /><span className="font-medium">Logout</span>
            </button>
          </div>
        </>
      )}

      {/* No spacer here: <main> reserves room for the bottom nav (pb-20 in app/layout.tsx). */}

      {/* FAB - Expenses only */}
      {activeModule === 'expenses' && (
        <button
          onClick={() => setShowQuickAdd(true)}
          className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40
                     w-14 h-14 rounded-full
                     bg-gradient-to-br from-blue-500 to-blue-600
                     text-white shadow-lg hover:shadow-2xl
                     flex items-center justify-center
                     transition-all duration-300 hover:scale-110 active:scale-95"
          aria-label="Quick add expense"
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      )}

      {/* Lazy load QuickAddExpense modal only when needed */}
      {showQuickAdd && (
        <Suspense fallback={null}>
          <QuickAddExpense
            isOpen={showQuickAdd}
            onClose={() => setShowQuickAdd(false)}
            onSuccess={() => window.dispatchEvent(new CustomEvent('expenseAdded'))}
          />
        </Suspense>
      )}
    </>
  );
}
