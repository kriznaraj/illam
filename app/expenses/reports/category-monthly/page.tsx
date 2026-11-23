'use client';

import { useState, useEffect, Fragment } from 'react';
import { formatCurrency, formatMonth } from '@/lib/utils';
import { getUserIcon } from '@/lib/userUtils';
import { getCategoryIcon } from '@/lib/categoryUtils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Category, User } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { PageContainer } from '@/components/PageContainer';
import { ExpandableChart } from '@/components/charts/ExpandableChart';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, MetricGrid } from '@/components/MetricCard';
import { TriangleAlert, X, Lightbulb } from 'lucide-react';

interface CategoryMonthlyData {
  category: Category;
  monthlyTotals: { [month: string]: number };
  total: number;
}

interface ReportData {
  months: string[];
  groupedData: {
    [groupName: string]: CategoryMonthlyData[];
  };
  monthlyTotals: { [month: string]: number };
  grandTotal: number;
}

export default function CategoryMonthlyReport() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [monthsBack, setMonthsBack] = useState(12);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    fetchUsers();

    // Mobile detection
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsBack, selectedUser]);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users');
      const data = await response.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setUsers([]);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ months: monthsBack.toString() });
      if (selectedUser) params.append('userId', selectedUser);

      const response = await fetch(`/api/reports/category-monthly?${params.toString()}`);
      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error('Failed to fetch report:', err);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryTrendData = (categoryId: string) => {
    if (!data) return [];

    const categoryData = Object.values(data.groupedData)
      .flat()
      .find((c) => c.category.id === categoryId);

    if (!categoryData) return [];

    return data.months.map((month) => ({
      month: formatMonth(month + '-01'),
      amount: categoryData.monthlyTotals[month] || 0,
    }));
  };

  if (loading) {
    return <LoadingSpinner message="Loading report..." />;
  }

  if (!data) {
    return (
      <PageContainer maxWidth="full">
        <EmptyState
          icon={TriangleAlert}
          title="Failed to load report"
          description="Try reloading this page in a moment."
        />
      </PageContainer>
    );
  }

  const selectedCategoryData = selectedCategory
    ? Object.values(data.groupedData)
        .flat()
        .find((c) => c.category.id === selectedCategory)
    : null;
  const activeCategories = Object.values(data.groupedData)
    .flat()
    .filter((categoryData) => categoryData.total > 0)
    .sort((a, b) => b.total - a.total);

  return (
    <PageContainer maxWidth="full">
      <PageHeader
        title="Category report"
        description="Monthly breakdown by category"
      />

      {/* Summary Cards */}
      <MetricGrid className="grid-cols-2 lg:grid-cols-4">
        <MetricCard tone="primary" label="Total Spending" value={formatCurrency(data.grandTotal)} />
        <MetricCard tone="green" label="Categories" value={Object.values(data.groupedData).flat().length} />
        <MetricCard
          tone="purple"
          label="Monthly Avg"
          value={formatCurrency(data.grandTotal / data.months.length)}
        />
        <MetricCard tone="orange" label="Period" value={`${monthsBack}M`} />
      </MetricGrid>

      {/* Filters */}
      <div className="card mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="label">
              Time Period
            </label>
            <select
              value={monthsBack}
              onChange={(e) => setMonthsBack(parseInt(e.target.value))}
              className="select"
            >
              <option value="3">Last 3 Months</option>
              <option value="6">Last 6 Months</option>
              <option value="12">Last 12 Months</option>
              <option value="24">Last 24 Months</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="label">
              Filter by User
            </label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="select"
            >
              <option value="">All Users</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {[getUserIcon(user), user.full_name].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Trend Line Chart */}
      {selectedCategory && selectedCategoryData && (
        <div className="card mb-4 sm:mb-6 animate-fadeIn">
          <div className="flex justify-between items-start gap-2 mb-3 sm:mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl sm:text-2xl">{getCategoryIcon(selectedCategoryData.category)}</span>
                <h2 className="text-base sm:text-xl font-bold text-gray-900 truncate">
                  {selectedCategoryData.category.name}
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-gray-600">
                {selectedCategoryData.category.group_name}
              </p>
              <p className="text-sm sm:text-base font-semibold text-primary-600 mt-1">
                Total: {formatCurrency(selectedCategoryData.total)}
              </p>
              {selectedCategoryData.total > 0 && data.months.length > 0 && (
                <p className="text-xs text-gray-500">
                  Avg: {formatCurrency(selectedCategoryData.total / data.months.length)}/month
                </p>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCategory(null);
              }}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors"
              aria-label="Close trend chart"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          <ExpandableChart
            title={`${selectedCategoryData.category.name} trend`}
            height={isMobile ? 200 : 280}
            expandedHeight={560}
            overlayButton
          >
            {() => (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={getCategoryTrendData(selectedCategory)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: isMobile ? 9 : 11 }}
                    angle={-45}
                    textAnchor="end"
                    height={isMobile ? 60 : 70}
                  />
                  <YAxis
                    tick={{ fontSize: isMobile ? 9 : 11 }}
                    tickFormatter={(value) => {
                      if (value >= 100000) return `₹${(value / 100000).toFixed(0)}L`;
                      if (value >= 1000) return `₹${(value / 1000).toFixed(0)}k`;
                      return `₹${value}`;
                    }}
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #ddd',
                      fontSize: isMobile ? '11px' : '12px',
                      padding: isMobile ? '4px 8px' : '8px 12px',
                    }}
                  />
                  {!isMobile && <Legend wrapperStyle={{ fontSize: '12px' }} />}
                  <Line
                    type="monotone"
                    dataKey="amount"
                    stroke={selectedCategoryData.category.color}
                    strokeWidth={isMobile ? 2 : 3}
                    name={isMobile ? selectedCategoryData.category.name.substring(0, 15) : selectedCategoryData.category.name}
                    dot={{ r: isMobile ? 3 : 4, fill: selectedCategoryData.category.color }}
                    activeDot={{ r: isMobile ? 5 : 7 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ExpandableChart>
        </div>
      )}

      {/* Category-wise Table */}
      <div className="card p-0 sm:p-6">
        <div className="px-4 sm:px-0 pt-4 sm:pt-0 mb-3 sm:mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <h2 className="text-base sm:text-xl font-bold text-gray-900">Monthly Breakdown</h2>
          {!isMobile && (
            <div className="text-sm text-gray-600">
              Total: <span className="font-bold text-gray-900">{formatCurrency(data.grandTotal)}</span>
            </div>
          )}
        </div>

        {isMobile && (
          <div className="mx-4 mb-3 p-2 bg-primary-50 border border-primary-200 rounded text-center">
            <p className="text-xs text-primary-800">
              Tap category for trend • Swipe to see months
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0 z-20">
              <tr>
                <th className={`${isMobile ? 'px-2 py-1.5 text-[10px]' : 'px-4 py-3 text-xs'} text-left font-semibold text-gray-700 uppercase sticky left-0 bg-gray-50 z-30 border-r border-gray-200`}>
                  {isMobile ? 'Cat' : 'Category'}
                </th>
                {!isMobile && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                    Group
                  </th>
                )}
                {data.months.map((month) => (
                  <th key={month} className={`${isMobile ? 'px-1.5 py-1.5 text-[10px]' : 'px-3 py-3 text-xs'} text-right font-semibold text-gray-700 uppercase whitespace-nowrap`}>
                    {isMobile ? formatMonth(month + '-01').substring(0, 3) : formatMonth(month + '-01')}
                  </th>
                ))}
                <th className={`${isMobile ? 'px-2 py-1.5 text-[10px]' : 'px-4 py-3 text-xs'} text-right font-semibold text-gray-700 uppercase sticky right-0 bg-gray-50 z-30 border-l border-gray-200`}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
            {Object.entries(data.groupedData).map(([groupName, categories]) => (
              <Fragment key={groupName}>
                {/* Group Header */}
                <tr className="bg-gray-50">
                  <td colSpan={isMobile ? data.months.length + 2 : data.months.length + 3} className={`${isMobile ? 'px-2 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'} font-bold text-gray-900`}>
                    {groupName}
                  </td>
                </tr>
                {/* Categories in Group */}
                {categories.map((catData) => (
                  <tr
                    key={catData.category.id}
                    className={`hover:bg-primary-50 cursor-pointer active:bg-primary-100 transition-colors ${
                      selectedCategory === catData.category.id ? 'bg-primary-50 ring-2 ring-primary-400 ring-inset' : ''
                    }`}
                    onClick={() => {
                      if (selectedCategory === catData.category.id) {
                        setSelectedCategory(null);
                      } else {
                        setSelectedCategory(catData.category.id);
                        if (isMobile) {
                          // Scroll to top to show the trend chart
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                      }
                    }}
                  >
                    <td className={`${isMobile ? 'px-2 py-2 text-xs' : 'px-4 py-3 text-sm'} text-gray-900 sticky left-0 bg-white hover:bg-primary-50 border-r border-gray-200 ${
                      selectedCategory === catData.category.id ? 'bg-primary-50' : ''
                    }`}>
                      <div className="flex items-center gap-1.5">
                        <span className={isMobile ? 'text-base' : 'text-lg'}>{getCategoryIcon(catData.category)}</span>
                        <span className={`${isMobile ? 'text-[11px] truncate max-w-[70px]' : 'text-sm'} font-medium`}>
                          {catData.category.name}
                        </span>
                      </div>
                    </td>
                    {!isMobile && (
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {catData.category.group_name}
                      </td>
                    )}
                    {data.months.map((month) => (
                      <td key={month} className={`${isMobile ? 'px-1.5 py-2 text-[11px]' : 'px-3 py-3 text-sm'} text-right text-gray-900 whitespace-nowrap`}>
                        {catData.monthlyTotals[month] > 0
                          ? isMobile
                            ? catData.monthlyTotals[month] >= 1000
                              ? `${(catData.monthlyTotals[month] / 1000).toFixed(0)}k`
                              : catData.monthlyTotals[month].toFixed(0)
                            : formatCurrency(catData.monthlyTotals[month])
                          : '-'}
                      </td>
                    ))}
                    <td className={`${isMobile ? 'px-2 py-2 text-[11px]' : 'px-4 py-3 text-sm'} text-right font-semibold text-gray-900 sticky right-0 bg-white hover:bg-primary-50 border-l border-gray-200 ${
                      selectedCategory === catData.category.id ? 'bg-primary-50' : ''
                    }`}>
                      {isMobile
                        ? catData.total >= 1000
                          ? `${(catData.total / 1000).toFixed(0)}k`
                          : catData.total.toFixed(0)
                        : formatCurrency(catData.total)}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {/* Monthly Totals Row */}
            <tr className="bg-primary-50 font-bold border-t-2 border-primary-300">
              <td className={`${isMobile ? 'px-2 py-2 text-xs' : 'px-4 py-3 text-sm'} text-primary-900 sticky left-0 bg-primary-100 z-10 border-r border-primary-300`}>
                {isMobile ? 'TOT' : 'TOTAL'}
              </td>
              {!isMobile && <td className="px-4 py-3"></td>}
              {data.months.map((month) => (
                <td key={month} className={`${isMobile ? 'px-1.5 py-2 text-[11px]' : 'px-3 py-3 text-sm'} text-right text-primary-900 whitespace-nowrap`}>
                  {isMobile
                    ? data.monthlyTotals[month] >= 1000
                      ? `${(data.monthlyTotals[month] / 1000).toFixed(0)}k`
                      : data.monthlyTotals[month].toFixed(0)
                    : formatCurrency(data.monthlyTotals[month])}
                </td>
              ))}
              <td className={`${isMobile ? 'px-2 py-2 text-xs' : 'px-4 py-3 text-sm'} text-right text-primary-900 sticky right-0 bg-primary-100 z-10 border-l border-primary-300`}>
                {isMobile
                  ? data.grandTotal >= 1000
                    ? `${(data.grandTotal / 1000).toFixed(0)}k`
                    : data.grandTotal.toFixed(0)
                  : formatCurrency(data.grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>
        </div>

        <div className={`${isMobile ? 'mx-4' : ''} mt-4 text-xs text-gray-500 text-center sm:text-left`}>
          <p className="inline-flex items-center gap-1.5">
            <Lightbulb size={14} className="flex-shrink-0" aria-hidden />
            <span>{isMobile ? 'Tap' : 'Click'} any category to {selectedCategory ? 'close or switch' : 'view'} trend chart</span>
          </p>
        </div>
      </div>

      {/* All category trendlines */}
      <div className="card mt-4 sm:mt-6">
        <div className="mb-3 sm:mb-4">
          <h2 className="text-base sm:text-xl font-bold text-gray-900">Trendline by Category</h2>
          <p className="text-xs sm:text-sm text-gray-500">Monthly line trend for every active category in this period.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {activeCategories.map((catData) => {
            const trendData = data.months.map((month) => ({
              month: formatMonth(month + '-01'),
              amount: catData.monthlyTotals[month] || 0,
            }));
            return (
              <button
                key={`trend-${catData.category.id}`}
                type="button"
                onClick={() => setSelectedCategory(catData.category.id)}
                className="text-left rounded-lg border border-gray-200 p-3 hover:border-primary-300 hover:bg-primary-50/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span>{getCategoryIcon(catData.category)}</span>
                      <p className="text-sm font-semibold text-gray-900 truncate">{catData.category.name}</p>
                    </div>
                    <p className="text-[11px] text-gray-500 truncate">{catData.category.group_name}</p>
                  </div>
                  <p className="text-xs font-semibold text-gray-700 whitespace-nowrap">{formatCurrency(catData.total)}</p>
                </div>
                <div className="h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 4, right: 2, left: 0, bottom: 2 }}>
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        labelFormatter={(label) => String(label)}
                        contentStyle={{ fontSize: '11px', padding: '6px 8px' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="amount"
                        stroke={catData.category.color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </PageContainer>
  );
}
