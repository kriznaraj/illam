'use client';

import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import Modal from './Modal';
import type { ActivityTrackerEvent, ActivityTrackerFormData, ActivityTrackerEventType } from '@/types';
import { EVENT_TYPE_OPTIONS } from '@/lib/activity-tracker/constants';
import { getTodayAppDate } from '@/lib/utils/dateUtils';

interface ActivityTrackerEventFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: ActivityTrackerFormData) => Promise<void>;
  event?: ActivityTrackerEvent | null;
  mode: 'create' | 'edit';
  defaultEventType?: ActivityTrackerEventType;
}

export default function ActivityTrackerEventForm({
  isOpen,
  onClose,
  onSubmit,
  event,
  mode,
  defaultEventType = 'one_time',
}: ActivityTrackerEventFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventType, setEventType] = useState<ActivityTrackerEventType>(defaultEventType);
  const [reminderDays, setReminderDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (event && mode === 'edit') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load the form from the event each time it opens
      setTitle(event.title);
      setDescription(event.description || '');
      setEventDate(event.event_date);
      setEventType(event.event_type);
      setReminderDays(event.reminder_days_before || 7);
    } else {
      setTitle('');
      setDescription('');
      setEventDate(getTodayAppDate());
      setEventType(defaultEventType);
      setReminderDays(7);
      setShowAdvanced(false);
    }
  }, [event, mode, isOpen, defaultEventType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const formData: ActivityTrackerFormData = {
        title,
        description: description || undefined,
        event_type: eventType,
        event_date: eventDate,
        reminder_days_before: eventType === 'annual' ? reminderDays : undefined,
      };

      await onSubmit(formData);
      onClose();
    } catch (error) {
      console.error('Error submitting form:', error);
      alert(error instanceof Error ? error.message : 'Failed to save event');
    } finally {
      setSubmitting(false);
    }
  };

  const dateLabel =
    eventType === 'activity' ? 'Started on' :
    eventType === 'annual' ? 'Date (this year)' :
    'When?';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create' ? 'New Event' : 'Edit Event'}
      maxWidth="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-secondary" disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            form="activity-tracker-form"
            className="btn btn-primary disabled:opacity-50"
            disabled={submitting}
          >
            {submitting ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </>
      }
    >
      <form id="activity-tracker-form" onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-2">What?</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input py-3"
            placeholder="e.g., Dance class, Alice's birthday"
            required
            autoFocus
          />
        </div>

        {mode === 'create' && (
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {EVENT_TYPE_OPTIONS.map(({ value, label, desc, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEventType(value)}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    eventType === value
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Icon size={18} className="mb-1 text-gray-500" aria-hidden />
                  <div className="text-sm font-medium text-gray-900">{label}</div>
                  <div className="text-xs text-gray-500 mt-0.5 leading-tight">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-900 mb-2">{dateLabel}</label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="input py-3"
            required
          />
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            <span>{showAdvanced ? 'Hide' : 'Show'} details</span>
          </button>

          {showAdvanced && (
            <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
              <div>
                <label className="label mb-2">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input py-3 resize-none"
                  rows={3}
                  placeholder="Optional notes..."
                />
              </div>
              {eventType === 'annual' && (
                <div>
                  <label className="label mb-2">
                    Remind me (days before)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={reminderDays}
                    onChange={(e) => setReminderDays(parseInt(e.target.value) || 7)}
                    className="input py-3"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
