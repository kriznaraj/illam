'use client';

import { useState, useMemo } from 'react';
import { CalendarPlus, CheckCircle, Pencil, Trash2, List, BarChart2, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { ActivityTrackerOccurrence } from '@/types';
import { format, parseISO, subDays } from 'date-fns';
import { getTodayAppDate, parseAppDate } from '@/lib/utils/dateUtils';
import { SegmentedControl } from './SegmentedControl';
import {
  buildOccurrenceBuckets,
  type OccurrenceBucket,
  type OccurrenceGrouping as Grouping,
} from '@/lib/activity-tracker/occurrenceBuckets';

interface ActivityOccurrencesPanelProps {
  isOpen: boolean;
  occurrences: ActivityTrackerOccurrence[];
  loading: boolean;
  onLogOccurrence: (options?: { date?: string; comment?: string }) => Promise<void>;
  onUpdateOccurrence: (
    occurrenceId: string,
    data: { date?: string; comment?: string }
  ) => Promise<void>;
  onDeleteOccurrence: (occurrenceId: string) => Promise<void>;
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

function useOccurrenceBuckets(
  occurrences: ActivityTrackerOccurrence[],
  grouping: Grouping,
  today: string
) {
  return useMemo(
    () => buildOccurrenceBuckets(occurrences, grouping, today),
    [occurrences, grouping, today]
  );
}

function OccurrenceBarChart({
  data,
  grouping,
}: {
  data: OccurrenceBucket[];
  grouping: Grouping;
}) {
  if (data.length === 0) return null;

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const average = total / data.length;
  const unit = grouping === 'weekly' ? 'week' : 'month';

  return (
    <div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="20%">
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
              width={20}
            />
            <Tooltip
              cursor={{ fill: '#F3F4F6' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload as { tooltip: string; count: number };
                return (
                  <div className="bg-white border border-gray-200 rounded-md px-2 py-1 text-xs shadow">
                    <span className="font-medium">{point.tooltip}</span>
                    <span className="text-gray-500 ml-1">— {point.count}×</span>
                  </div>
                );
              }}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={d.key}
                  fill={d.count === 0 ? '#F3F4F6' : i === data.length - 1 ? '#3B82F6' : '#BFDBFE'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {total}× over {data.length} {unit}
        {data.length === 1 ? '' : 's'} · avg {average.toFixed(average < 10 ? 1 : 0)} per {unit}
      </p>
    </div>
  );
}

export default function ActivityOccurrencesPanel({
  isOpen,
  occurrences,
  loading,
  onLogOccurrence,
  onUpdateOccurrence,
  onDeleteOccurrence,
  onToast,
}: ActivityOccurrencesPanelProps) {
  const today = getTodayAppDate();
  const [loggingDate, setLoggingDate] = useState<string | null>(null);
  const [showLogPrevious, setShowLogPrevious] = useState(false);
  const [previousDate, setPreviousDate] = useState(today);
  const [previousComment, setPreviousComment] = useState('');
  const [loggingPrevious, setLoggingPrevious] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editComment, setEditComment] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [view, setView] = useState<'list' | 'chart'>('list');
  const [grouping, setGrouping] = useState<Grouping>('weekly');

  const chartData = useOccurrenceBuckets(occurrences, grouping, today);

  /** Today, yesterday, and the day before — the three dates worth one tap. */
  const quickDays = useMemo(() => {
    const base = parseAppDate(today);
    return [0, 1, 2].map((offset) => {
      const date = subDays(base, offset);
      return {
        date: format(date, 'yyyy-MM-dd'),
        label: offset === 0 ? 'Today' : offset === 1 ? 'Yesterday' : format(date, 'EEEE'),
        sub: format(date, 'd MMM'),
      };
    });
  }, [today]);

  const loggedDates = useMemo(
    () => new Set(occurrences.map((occ) => occ.occurred_at)),
    [occurrences]
  );

  const handleQuickLog = async (date: string, label: string) => {
    if (loggedDates.has(date) || loggingDate) return;
    setLoggingDate(date);
    try {
      // `date` is always sent, so the server never has to infer "today" from its own clock.
      await onLogOccurrence({ date });
      onToast(`Logged for ${label.toLowerCase()}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to log';
      onToast(message, message.startsWith('Already logged') ? 'info' : 'error');
    } finally {
      setLoggingDate(null);
    }
  };

  const handleLogPrevious = async () => {
    if (!previousDate) return;
    setLoggingPrevious(true);
    try {
      await onLogOccurrence({
        date: previousDate,
        ...(previousComment.trim() ? { comment: previousComment.trim() } : {}),
      });
      onToast('Occurrence logged', 'success');
      setShowLogPrevious(false);
      setPreviousComment('');
      setPreviousDate(today);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to log';
      onToast(message, message.startsWith('Already logged') ? 'info' : 'error');
    } finally {
      setLoggingPrevious(false);
    }
  };

  const startEdit = (occ: ActivityTrackerOccurrence) => {
    setEditingId(occ.id);
    setEditDate(occ.occurred_at);
    setEditComment(occ.comment || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDate('');
    setEditComment('');
  };

  const handleSaveEdit = async (occurrenceId: string) => {
    setSavingEdit(true);
    try {
      await onUpdateOccurrence(occurrenceId, { date: editDate, comment: editComment });
      onToast('Occurrence updated', 'success');
      cancelEdit();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update';
      onToast(message, message.startsWith('Already logged') ? 'info' : 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (occurrenceId: string) => {
    if (!confirm('Delete this occurrence?')) return;
    try {
      await onDeleteOccurrence(occurrenceId);
      onToast('Occurrence deleted', 'success');
      if (editingId === occurrenceId) cancelEdit();
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Failed to delete', 'error');
    }
  };

  return (
    <div>
      {isOpen && (
        <div className="mb-4">
          <div className="grid grid-cols-3 gap-2">
            {quickDays.map(({ date, label, sub }) => {
              const alreadyLogged = loggedDates.has(date);
              const busy = loggingDate === date;
              return (
                <button
                  key={date}
                  onClick={() => handleQuickLog(date, label)}
                  disabled={alreadyLogged || loggingDate !== null}
                  className={`flex flex-col items-center justify-center gap-0.5 px-2 py-2.5 rounded-lg border transition-colors disabled:cursor-not-allowed ${
                    alreadyLogged
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 disabled:opacity-50'
                  }`}
                >
                  <span className="flex items-center gap-1 text-sm font-semibold leading-tight">
                    {busy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                    ) : (
                      alreadyLogged && <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                    <span className="truncate">{label}</span>
                  </span>
                  <span
                    className={`text-[11px] leading-tight ${alreadyLogged ? 'text-green-600' : 'text-primary-500'}`}
                  >
                    {alreadyLogged ? 'Logged' : sub}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setShowLogPrevious(!showLogPrevious)}
            className="mt-2 w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <CalendarPlus className="w-4 h-4" />
            Another date{showLogPrevious ? '' : '…'}
          </button>
        </div>
      )}

      {isOpen && showLogPrevious && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
          <div>
            <label className="label" htmlFor="occ-date">
              Date
            </label>
            <input
              id="occ-date"
              type="date"
              value={previousDate}
              onChange={(e) => setPreviousDate(e.target.value)}
              max={today}
              className="input-sm"
            />
          </div>
          <div>
            <label className="label" htmlFor="occ-comment">
              Comment (optional)
            </label>
            <input
              id="occ-comment"
              type="text"
              value={previousComment}
              onChange={(e) => setPreviousComment(e.target.value)}
              placeholder="e.g. skipped warm-up"
              className="input-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleLogPrevious}
              disabled={loggingPrevious || !previousDate}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50"
            >
              {loggingPrevious ? 'Adding...' : 'Add'}
            </button>
            <button
              onClick={() => {
                setShowLogPrevious(false);
                setPreviousComment('');
              }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Occurrences
          {!loading && occurrences.length > 0 && (
            <span className="ml-1 text-gray-400 normal-case">({occurrences.length})</span>
          )}
        </p>
        {!loading && occurrences.length > 0 && (
          <div className="flex items-center gap-2">
            {view === 'chart' && (
              <SegmentedControl<Grouping>
                value={grouping}
                onChange={setGrouping}
                ariaLabel="Chart grouping"
                options={[
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                ]}
              />
            )}
            <div className="flex items-center border border-gray-200 rounded-md overflow-hidden flex-shrink-0">
              <button
                onClick={() => setView('chart')}
                className={`p-1.5 ${view === 'chart' ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
                title="Chart view"
              >
                <BarChart2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setView('list')}
                className={`p-1.5 ${view === 'list' ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
                title="List view"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : occurrences.length === 0 ? (
        <p className="text-xs text-gray-400">
          {isOpen ? 'No occurrences yet — tap Today' : 'No occurrences recorded'}
        </p>
      ) : view === 'chart' ? (
        <OccurrenceBarChart data={chartData} grouping={grouping} />
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {occurrences.map((occ) => (
            <div
              key={occ.id}
              className="py-2 px-2 rounded-md hover:bg-gray-50 border border-transparent hover:border-gray-100"
            >
              {editingId === occ.id ? (
                <div className="space-y-2">
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    max={today}
                    className="input-sm"
                  />
                  <input
                    type="text"
                    value={editComment}
                    onChange={(e) => setEditComment(e.target.value)}
                    placeholder="Comment (optional)"
                    className="input-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(occ.id)}
                      disabled={savingEdit}
                      className="px-3 py-1 text-xs font-medium text-white bg-primary-600 rounded-md disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button onClick={cancelEdit} className="px-3 py-1 text-xs text-gray-600">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-gray-700">
                      {format(parseISO(occ.occurred_at), 'EEE, MMM d, yyyy')}
                    </span>
                    {occ.comment && <p className="text-xs text-gray-500 mt-0.5">{occ.comment}</p>}
                  </div>
                  {isOpen && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEdit(occ)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                        title="Edit occurrence"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(occ.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                        title="Delete occurrence"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
