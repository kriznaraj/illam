import type { ActivityTrackerEvent, ActivityTrackerFormData, ActivityTrackerOccurrence } from '@/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

export const activityTrackerApi = {
  getOpenEvents: () => request<ActivityTrackerEvent[]>('/api/activity-tracker?status=open'),

  getHistory: () => request<ActivityTrackerEvent[]>('/api/activity-tracker?history=true'),

  createEvent: (formData: ActivityTrackerFormData) =>
    request<ActivityTrackerEvent>('/api/activity-tracker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    }),

  updateEvent: (id: string, formData: Partial<ActivityTrackerFormData>) =>
    request<ActivityTrackerEvent>('/api/activity-tracker', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...formData }),
    }),

  deleteEvent: (id: string) =>
    request<{ success: boolean }>('/api/activity-tracker', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }),

  setEventStatus: (id: string, reopen = false) =>
    request<ActivityTrackerEvent>(`/api/activity-tracker/${id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reopen ? { reopen: true } : {}),
    }),

  getOccurrences: (eventId: string) =>
    request<ActivityTrackerOccurrence[]>(`/api/activity-tracker/${eventId}/occurrences`),

  logOccurrence: (eventId: string, options?: { date?: string; comment?: string }) =>
    request<ActivityTrackerOccurrence>(`/api/activity-tracker/${eventId}/occurrences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(options?.date ? { date: options.date } : {}),
        ...(options?.comment ? { comment: options.comment } : {}),
      }),
    }),

  updateOccurrence: (
    eventId: string,
    occurrenceId: string,
    data: { date?: string; comment?: string }
  ) =>
    request<ActivityTrackerOccurrence>(`/api/activity-tracker/${eventId}/occurrences/${occurrenceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deleteOccurrence: (eventId: string, occurrenceId: string) =>
    request<{ success: boolean }>(`/api/activity-tracker/${eventId}/occurrences/${occurrenceId}`, {
      method: 'DELETE',
    }),
};
