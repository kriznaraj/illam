'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useActivityTracker } from '@/lib/hooks/useActivityTracker';
import ActivityTrackerList from '@/components/ActivityTrackerList';
import ActivityTrackerEventForm from '@/components/ActivityTrackerEventForm';
import ActivityOccurrencesPanel from '@/components/ActivityOccurrencesPanel';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ModalRecordActions } from '@/components/ModalRecordActions';
import type { ActivityTrackerEvent, ActivityTrackerFormData, ActivityTrackerEventType, ActivityTrackerOccurrence } from '@/types';
import { EVENT_TABS } from '@/lib/activity-tracker/constants';
import {
  countEventsByType,
  getStatusActionCopy,
  summarizeOccurrences,
} from '@/lib/activity-tracker/display';
import { daysUntil, isWithinReminderWindow } from '@/lib/utils/recurrenceUtils';

export default function ActivityTrackerPage() {
  const [activeTab, setActiveTab] = useState<ActivityTrackerEventType>('activity');
  const {
    events: allEvents,
    closedEvents: allClosedEvents,
    loading,
    loadingHistory,
    createEvent,
    updateEvent,
    deleteEvent,
    closeEvent,
    reopenEvent,
    fetchOccurrences,
    logOccurrence,
    updateOccurrence,
    deleteOccurrence,
  } = useActivityTracker();

  const events = useMemo(
    () => allEvents.filter((e) => e.event_type === activeTab),
    [allEvents, activeTab]
  );

  const closedEvents = useMemo(
    () => allClosedEvents.filter((e) => e.event_type === activeTab),
    [allClosedEvents, activeTab]
  );

  const tabCounts = useMemo(() => countEventsByType(allEvents), [allEvents]);

  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [selectedEvent, setSelectedEvent] = useState<ActivityTrackerEvent | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmDialogConfig, setConfirmDialogConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    variant?: 'danger' | 'warning' | 'info' | 'success';
  }>({ title: '', message: '', onConfirm: () => {} });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [occurrences, setOccurrences] = useState<ActivityTrackerOccurrence[]>([]);
  const [loadingOccurrences, setLoadingOccurrences] = useState(false);
  const [occurrenceCounts, setOccurrenceCounts] = useState<Record<string, number>>({});
  const [lastOccurrenceDates, setLastOccurrenceDates] = useState<Record<string, string>>({});
  const [loggedTodayByEventId, setLoggedTodayByEventId] = useState<Record<string, boolean>>({});
  const [loggingEventId, setLoggingEventId] = useState<string | null>(null);

  const applyOccurrenceSummary = useCallback((eventId: string, occs: ActivityTrackerOccurrence[]) => {
    const { count, lastDate, loggedToday } = summarizeOccurrences(occs);
    setOccurrenceCounts((prev) => ({ ...prev, [eventId]: count }));
    setLoggedTodayByEventId((prev) => ({ ...prev, [eventId]: loggedToday }));
    if (lastDate) {
      setLastOccurrenceDates((prev) => ({ ...prev, [eventId]: lastDate }));
    }
  }, []);

  const refreshActivityData = useCallback(
    async (eventId: string, updateList = false) => {
      const occs = await fetchOccurrences(eventId);
      if (updateList) setOccurrences(occs);
      applyOccurrenceSummary(eventId, occs);
      return occs;
    },
    [fetchOccurrences, applyOccurrenceSummary]
  );

  const activityEventIds = useMemo(
    () =>
      allEvents
        .filter((e) => e.event_type === 'activity')
        .map((e) => e.id)
        .sort()
        .join(','),
    [allEvents]
  );

  useEffect(() => {
    if (!activityEventIds) {
      setOccurrenceCounts((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      setLastOccurrenceDates((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      setLoggedTodayByEventId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const activityIds = activityEventIds.split(',');

    Promise.all(
      activityIds.map(async (eventId) => {
        try {
          const occs = await fetchOccurrences(eventId);
          return { id: eventId, ...summarizeOccurrences(occs) };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      const counts: Record<string, number> = {};
      const lastDates: Record<string, string> = {};
      const loggedToday: Record<string, boolean> = {};
      for (const result of results) {
        if (!result) continue;
        counts[result.id] = result.count;
        loggedToday[result.id] = result.loggedToday;
        if (result.lastDate) lastDates[result.id] = result.lastDate;
      }
      setOccurrenceCounts(counts);
      setLastOccurrenceDates(lastDates);
      setLoggedTodayByEventId(loggedToday);
    });
  }, [activityEventIds, fetchOccurrences]);

  const loadOccurrences = useCallback(
    async (eventId: string) => {
      setLoadingOccurrences(true);
      try {
        await refreshActivityData(eventId, true);
      } catch {
        setOccurrences([]);
      } finally {
        setLoadingOccurrences(false);
      }
    },
    [refreshActivityData]
  );

  const handleCreateClick = () => {
    setSelectedEvent(null);
    setFormMode('create');
    setShowForm(true);
  };

  const handleViewDetails = (event: ActivityTrackerEvent) => {
    setSelectedEvent(event);
    setShowDetailModal(true);
    if (event.event_type === 'activity') {
      loadOccurrences(event.id);
    } else {
      setOccurrences([]);
    }
  };

  const handleQuickLog = async (event: ActivityTrackerEvent) => {
    if (loggedTodayByEventId[event.id] || loggingEventId === event.id) return;
    setLoggingEventId(event.id);
    try {
      await logOccurrence(event.id);
      await refreshActivityData(event.id, selectedEvent?.id === event.id);
      setToast({ message: 'Logged for today', type: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to log';
      if (message.startsWith('Already logged')) {
        await refreshActivityData(event.id, selectedEvent?.id === event.id);
      }
      setToast({
        message,
        type: message.startsWith('Already logged') ? 'info' : 'error',
      });
    } finally {
      setLoggingEventId(null);
    }
  };

  const handleCloseOrReopen = async () => {
    if (!selectedEvent) return;
    const reopen = selectedEvent.status !== 'open';
    const copy = getStatusActionCopy(selectedEvent, reopen);
    try {
      if (reopen) {
        await reopenEvent(selectedEvent.id);
      } else {
        await closeEvent(selectedEvent.id);
      }
      setToast({ message: copy.toast, type: 'success' });
      setShowDetailModal(false);
      setConfirmDialogOpen(false);
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : 'Failed to update status',
        type: 'error',
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedEvent) return;
    try {
      await deleteEvent(selectedEvent.id);
      setShowDetailModal(false);
      setConfirmDialogOpen(false);
      setToast({ message: 'Event deleted', type: 'success' });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : 'Failed to delete',
        type: 'error',
      });
    }
  };

  const handleFormSubmit = async (formData: ActivityTrackerFormData) => {
    if (formMode === 'create') {
      await createEvent(formData);
      setToast({ message: 'Event created', type: 'success' });
    } else if (selectedEvent) {
      await updateEvent(selectedEvent.id, formData);
      setToast({ message: 'Event updated', type: 'success' });
    }
  };

  const statusAction =
    selectedEvent && selectedEvent.event_type !== 'annual'
      ? getStatusActionCopy(selectedEvent, selectedEvent.status !== 'open')
      : null;

  const annualReminder =
    selectedEvent?.event_type === 'annual'
      ? isWithinReminderWindow(selectedEvent.event_date, selectedEvent.reminder_days_before)
      : false;

  if (loading) {
    return <LoadingSpinner message="Loading events..." />;
  }

  return (
    <PageContainer maxWidth="5xl">
      <PageHeader
        title="Activity Tracker"
        description="Family dates and reminders"
        action={
          <button onClick={handleCreateClick} className="btn btn-primary" aria-label="Create new event">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Event</span>
          </button>
        }
      />

      <div className="mb-6">
        <SegmentedControl
          value={activeTab}
          onChange={setActiveTab}
          className="w-full sm:w-fit"
          ariaLabel="Event type"
          options={EVENT_TABS.map((tab) => ({
            value: tab.value,
            label: (
              <>
                {tab.label}
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-white/80 text-blue-700">
                  {tabCounts[tab.value]}
                </span>
              </>
            ),
          }))}
        />
      </div>

      <ActivityTrackerList
        events={events}
        onViewDetails={handleViewDetails}
        onLogOccurrence={activeTab === 'activity' ? handleQuickLog : undefined}
        occurrenceCounts={occurrenceCounts}
        lastOccurrenceDates={lastOccurrenceDates}
        loggedTodayByEventId={loggedTodayByEventId}
        loggingEventId={loggingEventId}
      />

      {closedEvents.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 mb-4"
          >
            {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            History ({closedEvents.length})
          </button>
          {showHistory &&
            (loadingHistory ? (
              <LoadingSpinner message="Loading history..." />
            ) : (
              <ActivityTrackerList events={closedEvents} onViewDetails={handleViewDetails} isHistory />
            ))}
        </div>
      )}

      <ActivityTrackerEventForm
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleFormSubmit}
        event={selectedEvent}
        mode={formMode}
        defaultEventType={activeTab}
      />

      <Modal
        isOpen={showDetailModal && selectedEvent !== null}
        onClose={() => setShowDetailModal(false)}
        title="Event Details"
        maxWidth="lg"
        footer={
          selectedEvent && (
            <ModalRecordActions
              onDelete={() => {
                setConfirmDialogConfig({
                  title: 'Delete Event?',
                  message: `Delete "${selectedEvent.title}"? This cannot be undone.`,
                  variant: 'danger',
                  onConfirm: handleDelete,
                });
                setConfirmDialogOpen(true);
              }}
              onEdit={() => {
                setShowDetailModal(false);
                setFormMode('edit');
                setShowForm(true);
              }}
              onTertiary={
                statusAction
                  ? () => {
                      setConfirmDialogConfig({
                        title: statusAction.title,
                        message: statusAction.message,
                        variant: 'warning',
                        onConfirm: handleCloseOrReopen,
                      });
                      setConfirmDialogOpen(true);
                    }
                  : undefined
              }
              tertiaryLabel={statusAction?.button}
            />
          )
        }
      >
        {selectedEvent && (
          <div className="space-y-5">
            <div>
              <h3 className="text-lg font-semibold">{selectedEvent.title}</h3>
              {selectedEvent.description && (
                <p className="text-sm text-gray-600 mt-1">{selectedEvent.description}</p>
              )}
            </div>

            {selectedEvent.event_type === 'annual' && (
              <div
                className={`p-3 rounded-lg ${annualReminder ? 'bg-orange-50 border border-orange-200' : 'bg-gray-50'}`}
              >
                <p className="text-sm text-gray-700">
                  Every year on {format(parseISO(selectedEvent.event_date), 'MMMM d')}
                </p>
                {annualReminder && (
                  <p className="text-sm font-medium text-orange-700 mt-1">
                    {daysUntil(selectedEvent.event_date) === 0
                      ? 'Today!'
                      : `Coming up in ${daysUntil(selectedEvent.event_date)} days`}
                  </p>
                )}
              </div>
            )}

            {selectedEvent.event_type === 'one_time' && (
              <p className="text-sm text-gray-500">
                {format(parseISO(selectedEvent.event_date), 'MMMM d, yyyy')}
                {selectedEvent.status === 'open' && (
                  <span className="ml-2 text-green-600 font-medium">· Open for expense linking</span>
                )}
              </p>
            )}

            {selectedEvent.event_type === 'activity' && (
              <ActivityOccurrencesPanel
                isOpen={selectedEvent.status === 'open'}
                occurrences={occurrences}
                loading={loadingOccurrences}
                onLogOccurrence={async (options) => {
                  await logOccurrence(selectedEvent.id, options);
                  await refreshActivityData(selectedEvent.id, true);
                }}
                onUpdateOccurrence={async (occurrenceId, data) => {
                  await updateOccurrence(selectedEvent.id, occurrenceId, data);
                  await refreshActivityData(selectedEvent.id, true);
                }}
                onDeleteOccurrence={async (occurrenceId) => {
                  await deleteOccurrence(selectedEvent.id, occurrenceId);
                  await refreshActivityData(selectedEvent.id, true);
                }}
                onToast={(message, type) => setToast({ message, type })}
              />
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmDialogOpen}
        onClose={() => setConfirmDialogOpen(false)}
        onConfirm={confirmDialogConfig.onConfirm}
        title={confirmDialogConfig.title}
        message={confirmDialogConfig.message}
        variant={confirmDialogConfig.variant}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageContainer>
  );
}
