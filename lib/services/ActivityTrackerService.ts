import { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { ActivityTrackerRepository } from '../repositories/ActivityTrackerRepository';
import { ActivityTrackerOccurrenceRepository } from '../repositories/ActivityTrackerOccurrenceRepository';
import { advanceAnnualDate } from '../utils/recurrenceUtils';
import { getDuplicateOccurrenceMessage } from '../activity-tracker/display';
import { getTodayAppDate } from '../utils/dateUtils';
import type { ActivityTrackerEvent, ActivityTrackerFormData, ActivityTrackerOccurrence, ActivityTrackerEventType, ActivityTrackerStatus } from '@/types';

export class ActivityTrackerService extends BaseService {
  private repository: ActivityTrackerRepository;
  private occurrenceRepository: ActivityTrackerOccurrenceRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repository = new ActivityTrackerRepository(supabase);
    this.occurrenceRepository = new ActivityTrackerOccurrenceRepository(supabase);
  }

  async create(formData: ActivityTrackerFormData): Promise<ActivityTrackerEvent> {
    try {
      this.validateRequired(
        { title: formData.title, event_type: formData.event_type, event_date: formData.event_date },
        ['title', 'event_type', 'event_date']
      );
      this.validateDate(formData.event_date, 'Event date');

      const eventData: Partial<ActivityTrackerEvent> = {
        title: formData.title.trim(),
        description: formData.description?.trim() || null,
        event_type: formData.event_type,
        event_date: formData.event_date,
        status: 'open',
        reminder_days_before: formData.event_type === 'annual' ? (formData.reminder_days_before ?? 7) : 0,
        series_id: formData.event_type === 'annual' ? undefined : null,
      };

      const created = await this.repository.create(eventData);

      if (formData.event_type === 'annual' && !created.series_id) {
        return await this.repository.update(created.id, { series_id: created.id });
      }

      return created;
    } catch (error) {
      this.handleError(error, 'create activity tracker event');
    }
  }

  async update(id: string, formData: Partial<ActivityTrackerFormData>): Promise<ActivityTrackerEvent> {
    try {
      this.validateUUID(id, 'Event ID');

      const updateData: Partial<ActivityTrackerEvent> = {};
      if (formData.title !== undefined) updateData.title = formData.title.trim();
      if (formData.description !== undefined) updateData.description = formData.description?.trim() || null;
      if (formData.event_date !== undefined) {
        this.validateDate(formData.event_date, 'Event date');
        updateData.event_date = formData.event_date;
      }
      if (formData.reminder_days_before !== undefined) {
        updateData.reminder_days_before = formData.reminder_days_before;
      }

      return await this.repository.update(id, updateData);
    } catch (error) {
      this.handleError(error, 'update activity tracker event');
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.validateUUID(id, 'Event ID');
      await this.repository.delete(id);
    } catch (error) {
      this.handleError(error, 'delete activity tracker event');
    }
  }

  async close(id: string): Promise<ActivityTrackerEvent> {
    try {
      return await this.setStatus(id, 'closed');
    } catch (error) {
      this.handleError(error, 'close activity tracker event');
    }
  }

  async reopen(id: string): Promise<ActivityTrackerEvent> {
    try {
      return await this.setStatus(id, 'open');
    } catch (error) {
      this.handleError(error, 'reopen activity tracker event');
    }
  }

  private async setStatus(id: string, status: ActivityTrackerStatus): Promise<ActivityTrackerEvent> {
    this.validateUUID(id, 'Event ID');
    const event = await this.repository.findById(id);
    if (!event) throw new Error('Event not found');
    if (event.event_type === 'annual') {
      throw new Error(
        status === 'closed'
          ? 'Annual events cannot be closed manually'
          : 'Annual events cannot be reopened'
      );
    }
    return await this.repository.update(id, { status });
  }

  async logOccurrence(
    eventId: string,
    occurredAt?: string,
    comment?: string
  ): Promise<ActivityTrackerOccurrence> {
    try {
      this.validateUUID(eventId, 'Event ID');
      await this.assertActivityOpen(eventId);

      const date = occurredAt || getTodayAppDate();
      this.validateDate(date, 'Occurrence date');

      const existing = await this.occurrenceRepository.findByEventIdAndDate(eventId, date);
      if (existing) {
        throw new Error(getDuplicateOccurrenceMessage(date));
      }

      return await this.occurrenceRepository.create({
        event_id: eventId,
        occurred_at: date,
        comment: comment?.trim() || null,
      });
    } catch (error) {
      this.handleError(error, 'log occurrence');
    }
  }

  async updateOccurrence(
    eventId: string,
    occurrenceId: string,
    data: { occurred_at?: string; comment?: string }
  ): Promise<ActivityTrackerOccurrence> {
    try {
      this.validateUUID(eventId, 'Event ID');
      this.validateUUID(occurrenceId, 'Occurrence ID');
      await this.assertActivityOpen(eventId);

      const existing = await this.occurrenceRepository.findById(occurrenceId);
      if (!existing || existing.event_id !== eventId) {
        throw new Error('Occurrence not found');
      }

      const updateData: Partial<ActivityTrackerOccurrence> = {};
      if (data.occurred_at !== undefined) {
        this.validateDate(data.occurred_at, 'Occurrence date');
        if (data.occurred_at !== existing.occurred_at) {
          const conflict = await this.occurrenceRepository.findByEventIdAndDate(
            eventId,
            data.occurred_at
          );
          if (conflict) {
            throw new Error(getDuplicateOccurrenceMessage(data.occurred_at));
          }
        }
        updateData.occurred_at = data.occurred_at;
      }
      if (data.comment !== undefined) {
        updateData.comment = data.comment.trim() || null;
      }

      return await this.occurrenceRepository.update(occurrenceId, updateData);
    } catch (error) {
      this.handleError(error, 'update occurrence');
    }
  }

  async deleteOccurrence(eventId: string, occurrenceId: string): Promise<void> {
    try {
      this.validateUUID(eventId, 'Event ID');
      this.validateUUID(occurrenceId, 'Occurrence ID');
      await this.assertActivityOpen(eventId);

      const existing = await this.occurrenceRepository.findById(occurrenceId);
      if (!existing || existing.event_id !== eventId) {
        throw new Error('Occurrence not found');
      }

      await this.occurrenceRepository.delete(occurrenceId);
    } catch (error) {
      this.handleError(error, 'delete occurrence');
    }
  }

  private async assertActivityOpen(eventId: string): Promise<ActivityTrackerEvent> {
    const event = await this.repository.findById(eventId);
    if (!event) throw new Error('Event not found');
    if (event.event_type !== 'activity') {
      throw new Error('Only activity events can log occurrences');
    }
    if (event.status !== 'open') {
      throw new Error('Cannot modify occurrences on a closed activity');
    }
    return event;
  }

  async getOccurrences(eventId: string): Promise<ActivityTrackerOccurrence[]> {
    try {
      this.validateUUID(eventId, 'Event ID');
      return await this.occurrenceRepository.findByEventId(eventId);
    } catch (error) {
      this.handleError(error, 'get occurrences');
    }
  }

  async getFiltered(filters: {
    event_type?: ActivityTrackerEventType;
    status?: ActivityTrackerStatus;
    history?: boolean;
  }): Promise<ActivityTrackerEvent[]> {
    try {
      return await this.repository.findFiltered(filters);
    } catch (error) {
      this.handleError(error, 'get activity tracker events');
    }
  }

  async advanceAnnualEvents(): Promise<void> {
    try {
      const todayString = getTodayAppDate();

      const pastAnnual = await this.repository.findOpenAnnualPastDue(todayString);

      for (const event of pastAnnual) {
        try {
          let nextDate = advanceAnnualDate(event.event_date);
          while (nextDate < todayString) {
            nextDate = advanceAnnualDate(nextDate);
          }

          await this.repository.update(event.id, { status: 'closed' });

          await this.repository.create({
            title: event.title,
            description: event.description,
            event_type: 'annual',
            event_date: nextDate,
            status: 'open',
            reminder_days_before: event.reminder_days_before,
            notes: event.notes,
            series_id: event.series_id || event.id,
          });
        } catch (error) {
          console.error(`Failed to advance annual event ${event.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in advanceAnnualEvents:', error);
    }
  }
}
