'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { ChevronDown, Download, LogOut, MoreHorizontal, Plus, RefreshCw, Settings, User } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { classNames } from '@/lib/utils';
import { clearAllCache } from '@/lib/useClientCache';
import { useInboxAttention } from '@/lib/hooks/useInbox';
import {
  CASH_FLOW, CASH_FLOW_TABS, EXPENSES, EXPENSE_TABS, HOME, INBOX, MORE_ITEMS, NET_WORTH, NET_WORTH_TABS,
  isTabActive, sectionFor, type NavItem, type Section,
} from '@/lib/navigation';
import { IllamBrand } from './IllamLogo';
import { usePWAInstall } from '@/lib/pwa/usePWAInstall';

const QuickAddExpense = lazy(() => import('./QuickAddExpense'));

const DESKTOP_SECTIONS: Array<[Section, NavItem]> = [
  ['home', HOME],
  ['expenses', EXPENSES],
  ['net-worth', NET_WORTH],
  ['cash-flow', CASH_FLOW],
  ['inbox', INBOX],
];
const MOBILE_SECTIONS: Array<[Section, NavItem]> = [
  ['home', HOME],
  ['expenses', EXPENSES],
  ['net-worth', NET_WORTH],
  ['inbox', INBOX],
];

const menuPanel =
  'z-50 w-52 rounded-xl border border-gray-200 bg-white p-1 shadow-lg focus:outline-none focus-visible:ring-0 [--anchor-gap:6px]';
const menuRow =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-gray-700 data-[focus]:bg-gray-100';

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold leading-[18px] text-center tabular-nums">
      {count > 9 ? '9+' : count}
    </span>
  );
}

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, logout } = useAuth();
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Same cache key as the /home card, so both share one request.
  const { count: inboxCount } = useInboxAttention(3, pathname !== '/login');
  const pwa = usePWAInstall();
  const tabRow = useRef<HTMLDivElement>(null);

  // On a phone the tab row scrolls sideways; keep the current tab in view.
  useEffect(() => {
    tabRow.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  // Fade whichever edge has more tabs behind it, so a row that scrolls looks like it does.
  const [fade, setFade] = useState({ left: false, right: false });
  useEffect(() => {
    const row = tabRow.current;
    if (!row) return;
    const update = () =>
      setFade({ left: row.scrollLeft > 2, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 2 });
    update();
    row.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => {
      row.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [pathname]);

  if (pathname === '/login') return null;

  const section = sectionFor(pathname);
  const tabs =
    section === 'expenses' ? EXPENSE_TABS : section === 'net-worth' ? NET_WORTH_TABS : section === 'cash-flow' ? CASH_FLOW_TABS : [];
  const moreActive = MORE_ITEMS.some((item) => pathname.startsWith(item.href)) || pathname.startsWith('/account');

  const handleRefresh = () => {
    setIsRefreshing(true);
    clearAllCache();
    router.refresh();
    // Keep the spinner visible briefly, then tell the data hooks to refetch.
    setTimeout(() => {
      setIsRefreshing(false);
      window.dispatchEvent(new CustomEvent('cacheCleared'));
    }, 500);
  };

  const refreshButton = (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={isRefreshing}
      className="icon-button-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
      aria-label="Refresh data"
      title="Refresh data"
    >
      <RefreshCw size={17} className={classNames(isRefreshing && 'animate-spin')} />
    </button>
  );

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex h-14 items-center gap-6">
            <Link href="/home" className="flex items-center rounded-lg" aria-label="Illam home">
              <IllamBrand size={28} />
            </Link>

            {/* Desktop sections */}
            <nav aria-label="Main" className="hidden md:flex items-center gap-1">
              {DESKTOP_SECTIONS.map(([key, item]) => {
                const active = section === key;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={classNames(
                      'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                      active ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    {item.label}
                    {item === INBOX && <Badge count={inboxCount} />}
                  </Link>
                );
              })}
              <Menu>
                <MenuButton
                  className={classNames(
                    'flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    moreActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  )}
                >
                  More <ChevronDown size={14} aria-hidden />
                </MenuButton>
                <MenuItems anchor="bottom start" className={menuPanel}>
                  {MORE_ITEMS.map((item) => (
                    <MenuItem key={item.href}>
                      <Link href={item.href} className={menuRow}>
                        <item.icon size={16} className="text-gray-400" aria-hidden />
                        {item.label}
                      </Link>
                    </MenuItem>
                  ))}
                </MenuItems>
              </Menu>
            </nav>

            <div className="ml-auto flex items-center gap-1">
              {refreshButton}
              <Menu>
                <MenuButton className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                    <User size={15} aria-hidden />
                  </span>
                  <span className="hidden sm:inline font-medium">{currentUser?.full_name}</span>
                  <ChevronDown size={14} className="hidden sm:inline text-gray-400" aria-hidden />
                </MenuButton>
                <MenuItems anchor="bottom end" className={menuPanel}>
                  <MenuItem>
                    <Link href="/account" className={menuRow}>
                      <Settings size={16} className="text-gray-400" aria-hidden />
                      Account
                    </Link>
                  </MenuItem>
                  {pwa.canInstall && (
                    <MenuItem>
                      <button type="button" onClick={pwa.install} className={menuRow}>
                        <Download size={16} className="text-gray-400" aria-hidden />
                        Install app
                      </button>
                    </MenuItem>
                  )}
                  <div className="my-1 border-t border-gray-100" />
                  <MenuItem>
                    <button type="button" onClick={logout} className={classNames(menuRow, 'text-red-700')}>
                      <LogOut size={16} aria-hidden />
                      Sign out
                    </button>
                  </MenuItem>
                </MenuItems>
              </Menu>
            </div>
          </div>
        </div>

        {/* Section tabs: a row under the header, scrollable on phones */}
        {tabs.length > 0 && (
          <nav aria-label="Section" className="border-t border-gray-100">
            <div
              ref={tabRow}
              className={classNames(
                'max-w-7xl mx-auto px-1 sm:px-4 flex gap-0.5 sm:gap-1 overflow-x-auto scrollbar-none',
                fade.left && fade.right ? 'fade-x' : fade.right ? 'fade-right' : fade.left ? 'fade-left' : ''
              )}
            >
              {tabs.map((tab) => {
                const active = isTabActive(tab.href, pathname);
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? 'page' : undefined}
                    aria-label={tab.iconOnly ? tab.label : undefined}
                    title={tab.iconOnly ? tab.label : undefined}
                    className={classNames(
                      tab.iconOnly && 'ml-auto',
                      'flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 sm:px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'border-primary-600 text-primary-700'
                        : 'border-transparent text-gray-500 hover:text-gray-900'
                    )}
                  >
                    <tab.icon size={tab.iconOnly ? 17 : 15} className={tab.iconOnly ? undefined : 'hidden sm:block'} aria-hidden />
                    {!tab.iconOnly && tab.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        )}
      </header>

      {/* Phone bottom bar */}
      <nav
        aria-label="Main"
        className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-gray-200 bg-white safe-area-inset-bottom"
      >
        <div className="flex h-16">
          {MOBILE_SECTIONS.map(([key, item]) => {
            const active = section === key;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={classNames(
                  'relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium',
                  active ? 'text-primary-700' : 'text-gray-500'
                )}
              >
                <item.icon size={21} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                {item.label}
                {item === INBOX && inboxCount > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2">
                    <Badge count={inboxCount} />
                  </span>
                )}
              </Link>
            );
          })}
          <Menu>
            <MenuButton
              className={classNames(
                'flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium',
                moreActive || section === 'cash-flow' ? 'text-primary-700' : 'text-gray-500'
              )}
            >
              <MoreHorizontal size={21} aria-hidden />
              More
            </MenuButton>
            <MenuItems anchor="top end" className={classNames(menuPanel, 'w-56 [--anchor-gap:8px] [--anchor-padding:8px]')}>
              {[CASH_FLOW, ...MORE_ITEMS].map((item) => (
                <MenuItem key={item.href}>
                  <Link href={item.href} className={classNames(menuRow, 'py-2.5')}>
                    <item.icon size={17} className="text-gray-400" aria-hidden />
                    {item.label}
                  </Link>
                </MenuItem>
              ))}
              <div className="my-1 border-t border-gray-100" />
              <MenuItem>
                <Link href="/account" className={classNames(menuRow, 'py-2.5')}>
                  <Settings size={17} className="text-gray-400" aria-hidden />
                  Account
                </Link>
              </MenuItem>
            </MenuItems>
          </Menu>
        </div>
      </nav>

      {/* <main> reserves room for the bottom bar (pb-20 in app/layout.tsx). */}

      {section === 'expenses' && (
        <button
          type="button"
          onClick={() => setShowQuickAdd(true)}
          className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg transition-colors hover:bg-primary-700"
          aria-label="Add expense"
          title="Add expense"
        >
          <Plus size={26} strokeWidth={2.25} />
        </button>
      )}

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
