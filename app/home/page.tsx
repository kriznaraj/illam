'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatDate, getCurrentMonthString } from '@/lib/utils';
import { ExpenseWithCategory } from '@/types';
import Link from 'next/link';
import { PageContainer } from '@/components/PageContainer';
import Toast from '@/components/Toast';
import { useCachedFetch, invalidateCache } from '@/lib/useClientCache';
import { useInboxAttention } from '@/lib/hooks/useInbox';
import { useAuth } from '@/lib/AuthContext';
import { describeActionBy, itemIdentity, KIND_META, ownerLabel } from '@/lib/inbox/display';
import { CASH_FLOW, EXPENSES, INBOX, MORE_ITEMS, NET_WORTH } from '@/lib/navigation';

/** Shortcuts to every section, under the dashboard. */
const SECTION_TILES = [EXPENSES, NET_WORTH, INBOX, CASH_FLOW, ...MORE_ITEMS];

interface HomeStats {
  monthlyExpenses: number;
  expenseCount: number;
  netWorth: number;
  netWorthGrowth: number;
  recentExpenses: ExpenseWithCategory[];
  todayTodoCount: number;
  todayTodos: Array<{
    id: string;
    title: string;
    priority: 'low' | 'medium' | 'high';
    status: 'pending' | 'in_progress';
    due_date: string | null;
  }>;
}

const fetchStats = () => fetch(`/api/home-stats?t=${Date.now()}`).then(r => r.json()) as Promise<HomeStats>;

function KindIcon({ kind }: { kind: keyof typeof KIND_META }) {
  const Icon = KIND_META[kind].icon;
  return <Icon size={16} className="flex-shrink-0 text-gray-500" aria-hidden />;
}

export default function HomePage() {
  const { data: stats, loading, refresh } = useCachedFetch<HomeStats>(
    'home-stats',
    fetchStats,
    60_000  // 1 min TTL
  );
  const [showToast, setShowToast] = useState(false);
  const inbox = useInboxAttention(3);
  const { currentUser } = useAuth();

  // Read the clock in the browser, after the first render: the page is prerendered at build
  // time, so a greeting or month computed while rendering would be the build's, not now.
  const [now, setNow] = useState<Date | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe read of the client clock
  useEffect(() => setNow(new Date()), []);
  const greeting = !now ? 'Hello' : now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = currentUser?.full_name?.split(' ')[0];

  useEffect(() => {
    const handleExpenseAdded = () => {
      invalidateCache('home-stats');
      refresh();
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    };
    window.addEventListener('expenseAdded', handleExpenseAdded);
    return () => window.removeEventListener('expenseAdded', handleExpenseAdded);
  }, [refresh]);

  // Listen for cache clear events from refresh button
  useEffect(() => {
    const handleCacheCleared = () => {
      refresh();
    };
    window.addEventListener('cacheCleared', handleCacheCleared);
    return () => window.removeEventListener('cacheCleared', handleCacheCleared);
  }, [refresh]);

  // Auto-complete past reminder events (birthdays, anniversaries) on page load
  useEffect(() => {
    // Fire-and-forget - don't wait for response or handle errors
    fetch('/api/activity-tracker/auto-complete', { method: 'POST' }).catch(() => {});
  }, []);

  return (
    <PageContainer maxWidth="7xl">
      <div className="mb-6">
        <h1 className="text-2xl md:text-[1.75rem] font-semibold text-gray-900">
          {greeting}{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-sm text-gray-500 mt-1 min-h-[1.25rem]">{now ? getCurrentMonthString() : ''}</p>
      </div>

      {/* Inbox: what is still waiting on someone */}
      {inbox.count > 0 && (
        <div className="card mb-6 border-amber-200 bg-amber-50">
          <div className="flex justify-between items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900 min-w-0">
              {inbox.count} thing{inbox.count === 1 ? '' : 's'} waiting on you
            </h2>
            <Link href="/inbox?view=todo" className="text-sm font-medium text-primary-700 hover:underline whitespace-nowrap">
              Open inbox →
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {inbox.items.map((item) => {
              const urgency = describeActionBy(item.action_by);
              return (
                <Link
                  key={item.id}
                  href="/inbox?view=todo"
                  className="flex items-center gap-2 rounded-lg bg-white border border-amber-100 px-3 py-2"
                >
                  <KindIcon kind={item.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{itemIdentity(item).headline}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {urgency?.label ?? item.attention_reason} · {ownerLabel(item.owner)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Today's Todos */}
      {!loading && (stats?.todayTodoCount || 0) > 0 && (
        <div className="card mb-6">
          <div className="flex justify-between items-center gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900">{stats?.todayTodoCount} task{stats?.todayTodoCount === 1 ? '' : 's'} due today</h2>
            </div>
            <Link href="/todos" className="text-sm font-medium text-primary-700 hover:underline whitespace-nowrap">
              View all →
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {stats?.todayTodos?.slice(0, 3).map((todo) => (
              <div key={todo.id} className="rounded-lg border border-gray-100 px-3 py-2">
                <p className="text-sm font-medium text-gray-900 truncate">{todo.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {todo.status === 'in_progress' ? 'In progress' : 'Pending'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <Link href="/expenses" className="card card-hover">
          <div className="text-xs text-gray-500 mb-1">Spent this month</div>
          {loading ? (
            <div className="animate-pulse space-y-1.5">
              <div className="h-7 bg-gray-200 rounded w-32" />
              <div className="h-3 bg-gray-200 rounded w-20" />
            </div>
          ) : (
            <>
              <div className="text-xl font-semibold text-gray-900 tabular-nums">
                {formatCurrency(stats?.monthlyExpenses || 0)}
              </div>
              <div className="text-xs text-gray-500 mt-1">{stats?.expenseCount || 0} {stats?.expenseCount === 1 ? 'expense' : 'expenses'}</div>
            </>
          )}
        </Link>

        <Link href="/portfolio" className="card card-hover">
          <div className="text-xs text-gray-500 mb-1">Net worth</div>
          {loading ? (
            <div className="animate-pulse space-y-1.5">
              <div className="h-7 bg-gray-200 rounded w-36" />
              <div className="h-3 bg-gray-200 rounded w-16" />
            </div>
          ) : (
            <>
              <div className="text-xl font-semibold text-gray-900 tabular-nums">
                {formatCurrency(stats?.netWorth || 0)}
              </div>
              <div className={`text-xs mt-1 ${(stats?.netWorthGrowth || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {(stats?.netWorthGrowth || 0) >= 0 ? '↑' : '↓'} {Math.abs(stats?.netWorthGrowth || 0).toFixed(1)}%
              </div>
            </>
          )}
        </Link>
      </div>

      {/* Recent Expenses */}
      <div className="card">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-base font-semibold text-gray-900">Recent expenses</h2>
          <Link href="/expenses" className="text-sm font-medium text-primary-700 hover:underline">
            View all →
          </Link>
        </div>
        {loading ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-2 h-2 rounded-full bg-gray-200 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-gray-200 rounded w-40" />
                    <div className="h-3 bg-gray-200 rounded w-24" />
                  </div>
                </div>
                <div className="h-4 bg-gray-200 rounded w-20 ml-3" />
              </div>
            ))}
          </div>
        ) : stats?.recentExpenses && stats.recentExpenses.length > 0 ? (
          <div className="space-y-2">
            {stats.recentExpenses.slice(0, 5).map((expense) => (
              <div
                key={expense.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: expense.category.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">
                      {expense.description || expense.category.name}
                    </p>
                    <p className="text-xs text-gray-500">{formatDate(expense.date)}</p>
                  </div>
                </div>
                <span className="font-semibold text-gray-900 text-sm ml-3 tabular-nums">
                  {formatCurrency(parseFloat(expense.amount.toString()))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-4">No expenses this month</p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
        {SECTION_TILES.map(({ href, label, hint, icon: Icon }) => (
          <Link key={href} href={href} className="card card-hover flex items-center gap-3 !p-3.5">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-primary-50 text-primary-700">
              <Icon size={18} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">{label}</span>
              <span className="block text-xs text-gray-500 truncate">{hint}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* Toast Notification */}
      {showToast && (
        <Toast
          message="Expense added"
          type="success"
          onClose={() => setShowToast(false)}
        />
      )}
    </PageContainer>
  );
}
