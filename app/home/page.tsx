'use client';

import { useEffect, useState, useMemo } from 'react';
import { formatCurrency, formatDate, getCurrentMonthString } from '@/lib/utils';
import { ExpenseWithCategory } from '@/types';
import Link from 'next/link';
import { PageContainer } from '@/components/PageContainer';
import Toast from '@/components/Toast';
import { useCachedFetch, invalidateCache } from '@/lib/useClientCache';
import { Receipt, TrendingUp, FileText, CheckSquare, CalendarClock, Mail } from 'lucide-react';

/** The module tiles under the dashboard. Tamil names, with what each one is for. */
const MODULE_TILES = [
  { href: '/expenses', name: 'Selavu', hint: 'Spending', Icon: Receipt, tone: 'bg-blue-50 text-blue-600' },
  { href: '/portfolio', name: 'Selvam', hint: 'Wealth & net worth', Icon: TrendingUp, tone: 'bg-emerald-50 text-emerald-600' },
  { href: '/inbox', name: 'Madal', hint: 'Bank mail inbox', Icon: Mail, tone: 'bg-amber-50 text-amber-600' },
  { href: '/activity-tracker', name: 'Activity', hint: 'Dates & habits', Icon: CalendarClock, tone: 'bg-indigo-50 text-indigo-600' },
  { href: '/notes', name: 'Kurippu', hint: 'Notes', Icon: FileText, tone: 'bg-purple-50 text-purple-600' },
  { href: '/todos', name: 'Seyal', hint: 'To-dos', Icon: CheckSquare, tone: 'bg-orange-50 text-orange-600' },
] as const;
import { useInboxAttention } from '@/lib/hooks/useInbox';
import { describeActionBy, itemIdentity, KIND_META, ownerLabel } from '@/lib/inbox/display';

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

export default function HomePage() {
  const { data: stats, loading, refresh } = useCachedFetch<HomeStats>(
    'home-stats',
    fetchStats,
    60_000  // 1 min TTL
  );
  const [showToast, setShowToast] = useState(false);
  const inbox = useInboxAttention(3);

  // Memoize personalized greeting to avoid recalculating on every render
  const personalizedGreeting = useMemo(() => {
    const hour = new Date().getHours();
    const day = new Date().getDay();
    if (day === 0 || day === 6) return '🌟 Happy Weekend!';
    if (hour < 12) return '☀️ Good Morning!';
    if (hour < 17) return '🌤️ Good Afternoon!';
    if (hour < 21) return '🌆 Good Evening!';
    return '🌙 Good Night!';
  }, []); // Empty deps - greeting only calculated once per page load

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
      {/* Hero Section */}
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-1">
          {personalizedGreeting}
        </h1>
        <p className="text-gray-600 text-sm">{getCurrentMonthString()}</p>
      </div>

      {/* Madal: what is still waiting on someone */}
      {inbox.count > 0 && (
        <div className="card mb-6 border border-amber-100 bg-amber-50/40">
          <div className="flex justify-between items-center gap-3">
            <h2 className="text-base font-bold text-gray-900 min-w-0">
              {inbox.count} thing{inbox.count === 1 ? '' : 's'} waiting on you
            </h2>
            <Link href="/inbox?view=todo" className="text-sm text-blue-600 hover:text-blue-800 whitespace-nowrap">
              Open Madal →
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {inbox.items.map((item) => {
              const urgency = describeActionBy(item.action_by);
              return (
                <Link
                  key={item.id}
                  href="/inbox?view=todo"
                  className="flex items-center gap-2 rounded-lg bg-white/80 border border-amber-100 px-3 py-2"
                >
                  <span aria-hidden>{KIND_META[item.kind].icon}</span>
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
        <div className="card mb-6 border border-orange-100 bg-orange-50/40">
          <div className="flex justify-between items-center gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900">{stats?.todayTodoCount} task{stats?.todayTodoCount === 1 ? '' : 's'} due today</h2>

            </div>
            <Link href="/todos" className="text-sm text-blue-600 hover:text-blue-800 whitespace-nowrap">
              View All →
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {stats?.todayTodos?.slice(0, 3).map((todo) => (
              <div key={todo.id} className="rounded-lg bg-white/80 border border-orange-100 px-3 py-2">
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
        <Link href="/expenses" className="card hover:shadow-md transition-shadow">
          <div className="text-xs text-gray-600 mb-1">This Month</div>
          {loading ? (
            <div className="animate-pulse space-y-1.5">
              <div className="h-7 bg-gray-200 rounded w-32" />
              <div className="h-3 bg-gray-200 rounded w-20" />
            </div>
          ) : (
            <>
              <div className="text-xl font-bold text-gray-900">
                {formatCurrency(stats?.monthlyExpenses || 0)}
              </div>
              <div className="text-xs text-gray-500 mt-1">{stats?.expenseCount || 0} {stats?.expenseCount === 1 ? 'expense' : 'expenses'}</div>
            </>
          )}
        </Link>

        <Link href="/portfolio" className="card hover:shadow-md transition-shadow">
          <div className="text-xs text-gray-600 mb-1">Net Worth</div>
          {loading ? (
            <div className="animate-pulse space-y-1.5">
              <div className="h-7 bg-gray-200 rounded w-36" />
              <div className="h-3 bg-gray-200 rounded w-16" />
            </div>
          ) : (
            <>
              <div className="text-xl font-bold text-gray-900">
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
          <h2 className="text-base font-bold text-gray-900">Recent Expenses</h2>
          <Link href="/expenses" className="text-sm text-blue-600 hover:text-blue-800">
            View All →
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
                <span className="font-bold text-gray-900 text-sm ml-3">
                  {formatCurrency(parseFloat(expense.amount.toString()))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-4">No expenses this month</p>
        )}
      </div>

      {/* Modules */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
        {MODULE_TILES.map(({ href, name, hint, Icon, tone }) => (
          <Link
            key={href}
            href={href}
            className="card flex items-center gap-3 py-3.5 px-4 hover:shadow-md hover:-translate-y-px transition-all"
          >
            <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${tone}`}>
              <Icon size={20} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-gray-900">{name}</span>
              <span className="block text-xs text-gray-500 truncate">{hint}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* Toast Notification */}
      {showToast && (
        <Toast
          message="✓ Expense added successfully!"
          type="success"
          onClose={() => setShowToast(false)}
        />
      )}
    </PageContainer>
  );
}
