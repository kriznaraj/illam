'use client';

import { Calendar, CheckCircle, ChevronRight, Loader2 } from 'lucide-react';
import type { ActivityTrackerEvent } from '@/types';
import { format, parseISO } from 'date-fns';
import { ListItemRow } from '@/components/ListItemRow';
import { EVENT_TYPE_ICON } from '@/lib/activity-tracker/constants';
import { getEventStatusLabel, getStatusBadgeClass } from '@/lib/activity-tracker/display';

interface ActivityTrackerListProps {
  events: ActivityTrackerEvent[];
  onViewDetails: (event: ActivityTrackerEvent) => void;
  onLogOccurrence?: (event: ActivityTrackerEvent) => void;
  occurrenceCounts?: Record<string, number>;
  lastOccurrenceDates?: Record<string, string>;
  loggedTodayByEventId?: Record<string, boolean>;
  loggingEventId?: string | null;
  isHistory?: boolean;
}

function EventTypeIcon({ type }: { type: keyof typeof EVENT_TYPE_ICON }) {
  const Icon = EVENT_TYPE_ICON[type];
  return <Icon size={14} className="flex-shrink-0 text-gray-500" aria-hidden />;
}

export default function ActivityTrackerList({
  events,
  onViewDetails,
  onLogOccurrence,
  occurrenceCounts = {},
  lastOccurrenceDates = {},
  loggedTodayByEventId = {},
  loggingEventId = null,
  isHistory = false,
}: ActivityTrackerListProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
        <Calendar className="w-16 h-16 mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500 text-sm">
          {isHistory ? 'No history yet' : 'No events yet'}
        </p>
        <p className="text-gray-400 text-xs mt-1">
          {isHistory ? 'Closed events will appear here' : 'Create your first event to get started'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((event) => {
        const statusLabel = getEventStatusLabel(event, isHistory);
        const count = occurrenceCounts[event.id];
        const lastDate = lastOccurrenceDates[event.id];
        const loggedToday = loggedTodayByEventId[event.id];
        const isLogging = loggingEventId === event.id;

        return (
          <div
            key={event.id}
            className="bg-white border border-gray-200 rounded-lg transition-all hover:shadow-md"
          >
            <ListItemRow
              title={
                <span className="flex items-center gap-2">
                  <EventTypeIcon type={event.event_type} />
                  <span className="truncate">{event.title}</span>
                </span>
              }
              subtitle={
                event.description ? (
                  <span className="line-clamp-1 text-gray-500">{event.description}</span>
                ) : event.event_type === 'activity' && count ? (
                  <span className="text-gray-500">
                    {count} logged{lastDate ? ` · last ${format(parseISO(lastDate), 'MMM d')}` : ''}
                  </span>
                ) : undefined
              }
              meta={
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  {event.event_type !== 'activity' && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {format(parseISO(event.event_date), 'MMM d, yyyy')}
                    </span>
                  )}
                  {statusLabel && (
                    <span className={`px-2 py-0.5 rounded-full ${getStatusBadgeClass(statusLabel)}`}>
                      {statusLabel}
                    </span>
                  )}
                </div>
              }
              onClick={() => onViewDetails(event)}
              trailing={<ChevronRight className="w-4 h-4 text-gray-400" />}
            />

            {!isHistory && event.event_type === 'activity' && event.status === 'open' && onLogOccurrence && (
              <div className="px-4 pb-3 -mt-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onLogOccurrence(event);
                  }}
                  disabled={loggedToday || isLogging}
                  className={`w-full py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed ${
                    loggedToday
                      ? 'text-green-700 bg-green-50'
                      : 'text-primary-700 bg-primary-50 hover:bg-primary-100 disabled:opacity-60'
                  }`}
                >
                  {isLogging ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  {isLogging ? 'Logging...' : loggedToday ? 'Logged today' : 'Log today'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
