'use client';

import { useState, useEffect } from 'react';
import { FlaskConical, RefreshCw, Copy, Trash2 } from 'lucide-react';

export default function DebugPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [platform, setPlatform] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setUserAgent(navigator.userAgent);
    setPlatform(navigator.platform);
    loadLogs();
  }, []);

  const loadLogs = () => {
    try {
      const storedLogs = JSON.parse(localStorage.getItem('expense-debug-logs') || '[]');
      setLogs(storedLogs.reverse()); // Show newest first
    } catch (e) {
      console.error('Failed to load logs:', e);
    }
  };

  const clearLogs = () => {
    localStorage.removeItem('expense-debug-logs');
    setLogs([]);
  };

  const clearAllCaches = () => {
    try {
      // Clear all app cache entries, preserve auth session
      const keys = Object.keys(sessionStorage);
      const clearedKeys: string[] = [];
      keys.forEach(key => {
        if (key.startsWith('app-cache-')) {
          sessionStorage.removeItem(key);
          clearedKeys.push(key);
        }
      });

      // Dispatch cache cleared event
      window.dispatchEvent(new Event('cacheCleared'));

      const testLog = {
        timestamp: new Date().toISOString(),
        message: 'All caches cleared (auth preserved)',
        data: {
          clearedKeys,
          clearedCount: clearedKeys.length,
          preservedKeys: keys.filter(k => !k.startsWith('app-cache-')).length
        },
        userAgent: navigator.userAgent,
      };

      const logs = JSON.parse(localStorage.getItem('expense-debug-logs') || '[]');
      logs.push(testLog);
      localStorage.setItem('expense-debug-logs', JSON.stringify(logs));

      alert(`All caches cleared! Auth session preserved.\n• Cleared: ${clearedKeys.length} cache entries\n• Preserved: ${keys.length - clearedKeys.length} items (including auth)`);
      loadLogs();
    } catch (e) {
      alert('Cache clear failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const copyLogs = () => {
    const text = JSON.stringify(logs, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      alert('Logs copied to clipboard!');
    });
  };

  const testLogging = () => {
    try {
      const testLog = {
        timestamp: new Date().toISOString(),
        message: 'TEST: Debug system working',
        data: {
          test: true,
          timestamp: Date.now(),
        },
        userAgent: navigator.userAgent,
      };

      const logs = JSON.parse(localStorage.getItem('expense-debug-logs') || '[]');
      logs.push(testLog);
      localStorage.setItem('expense-debug-logs', JSON.stringify(logs));

      alert('Test log added! Refresh to see it.');
      loadLogs();
    } catch (e) {
      alert('Logging failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const testTagsAPI = async () => {
    try {
      const response = await fetch('/api/tags');
      const tags = await response.json();

      const testLog = {
        timestamp: new Date().toISOString(),
        message: 'TEST: Tags API Response',
        data: {
          status: response.status,
          tagsCount: Array.isArray(tags) ? tags.length : 0,
          tags: tags,
        },
        userAgent: navigator.userAgent,
      };

      const logs = JSON.parse(localStorage.getItem('expense-debug-logs') || '[]');
      logs.push(testLog);
      localStorage.setItem('expense-debug-logs', JSON.stringify(logs));

      alert(`Tags API test complete! Found ${Array.isArray(tags) ? tags.length : 0} tags. Refresh to see details.`);
      loadLogs();
    } catch (e) {
      alert('Tags API test failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const testExpenseWithTags = async () => {
    try {
      const response = await fetch('/api/expenses?limit=10');
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        const errorMessage =
          errorPayload && typeof errorPayload === 'object' && 'error' in errorPayload
            ? String((errorPayload as { error?: unknown }).error ?? 'Failed to fetch expenses')
            : 'Failed to fetch expenses';
        throw new Error(errorMessage);
      }
      const expenses = await response.json();

      const expensesWithTags = Array.isArray(expenses)
        ? expenses.filter((e: any) => e.tags && e.tags.length > 0)
        : [];

      const testLog = {
        timestamp: new Date().toISOString(),
        message: 'TEST: Recent Expenses with Tags',
        data: {
          status: response.status,
          totalExpenses: Array.isArray(expenses) ? expenses.length : 0,
          expensesWithTags: expensesWithTags.length,
          percentageWithTags: Array.isArray(expenses) && expenses.length > 0
            ? Math.round((expensesWithTags.length / expenses.length) * 100)
            : 0,
          sample: Array.isArray(expenses) ? expenses.slice(0, 3).map((e: any) => ({
            id: e.id,
            amount: e.amount,
            description: e.description,
            has_tags: !!e.tags,
            tags_count: e.tags?.length || 0,
            tags: e.tags,
            expense_tags_raw: e.expense_tags,
          })) : [],
        },
        userAgent: navigator.userAgent,
      };

      const logs = JSON.parse(localStorage.getItem('expense-debug-logs') || '[]');
      logs.push(testLog);
      localStorage.setItem('expense-debug-logs', JSON.stringify(logs));

      alert(`Test complete!\n• Total expenses: ${Array.isArray(expenses) ? expenses.length : 0}\n• With tags: ${expensesWithTags.length}\n\nRefresh to see details.`);
      loadLogs();
    } catch (e) {
      alert('Expense test failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const filteredLogs = filter
    ? logs.filter(log =>
        JSON.stringify(log).toLowerCase().includes(filter.toLowerCase())
      )
    : logs;

  // Don't render until mounted to avoid hydration issues
  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
        <div className="text-gray-500">Loading debug info...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4 pb-20">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-4 sm:p-6 mb-3 sm:mb-4">
          <h1 className="text-xl sm:text-2xl font-semibold mb-3 sm:mb-4">Diagnostics</h1>

          {/* System Info */}
          <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-gray-600 space-y-1">
            <p className="break-all"><strong>User Agent:</strong> {userAgent}</p>
            <p><strong>Platform:</strong> {platform}</p>
            <p><strong>Total Logs:</strong> {logs.length}</p>
            <p><strong>localStorage:</strong> {typeof localStorage !== 'undefined' ? 'Yes' : 'No'}</p>
          </div>

          {/* Test Banner */}
          <div className="mb-3 sm:mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="flex items-center gap-1.5 font-semibold text-sm mb-2">
              <FlaskConical size={16} aria-hidden />
              Test Tools
            </p>
            <div className="space-y-2">
              <button
                onClick={testLogging}
                className="w-full px-3 py-1.5 bg-yellow-500 text-white rounded hover:bg-yellow-600 text-xs font-medium"
              >
                Test Logging System
              </button>
              <button
                onClick={testTagsAPI}
                className="w-full px-3 py-1.5 bg-primary-500 text-white rounded hover:bg-primary-600 text-xs font-medium"
              >
                Test Tags API
              </button>
              <button
                onClick={testExpenseWithTags}
                className="w-full px-3 py-1.5 bg-purple-500 text-white rounded hover:bg-purple-600 text-xs font-medium"
              >
                Test Expenses + Tags
              </button>
              <button
                onClick={clearAllCaches}
                className="w-full px-3 py-1.5 bg-orange-500 text-white rounded hover:bg-orange-600 text-xs font-medium"
              >
                Clear All Caches
              </button>
            </div>
          </div>

          {/* Filter & Actions */}
          <div className="space-y-2 mb-3 sm:mb-0">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter logs..."
              className="input-sm"
            />
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={loadLogs}
                className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium"
              >
                <RefreshCw size={16} aria-hidden />
                Refresh
              </button>
              <button
                onClick={copyLogs}
                className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm font-medium"
              >
                <Copy size={16} aria-hidden />
                Copy
              </button>
              <button
                onClick={clearLogs}
                className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium"
              >
                <Trash2 size={16} aria-hidden />
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Logs List */}
        <div className="space-y-2">
          {filteredLogs.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-6 sm:p-8 text-center text-gray-500 text-sm">
              No logs found. Try editing an expense to generate logs.
            </div>
          ) : (
            filteredLogs.map((log, index) => (
              <div key={index} className="bg-white rounded-lg shadow-sm p-3 sm:p-4">
                <div className="flex items-start justify-between mb-2 gap-2">
                  <span className="text-xs text-gray-500 break-all">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                  <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded flex-shrink-0">
                    #{logs.length - index}
                  </span>
                </div>
                <div className="font-medium text-xs sm:text-sm mb-2 break-words">{log.message}</div>
                {log.data && (
                  <pre className="text-xs bg-gray-50 p-2 sm:p-3 rounded overflow-x-auto break-all whitespace-pre-wrap">
                    {JSON.stringify(log.data, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
