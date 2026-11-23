import { BaseService } from './BaseService';
import { EventRepository } from '@/lib/repositories/EventRepository';
import { Event } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Event Service
 * Handles all business logic for events
 */
export class EventService extends BaseService {
  private eventRepo: EventRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.eventRepo = new EventRepository(supabase);
  }

  async getAllEvents(): Promise<Event[]> {
    try {
      return await this.eventRepo.findAllSorted();
    } catch (error) {
      this.handleError(error, 'get all events');
    }
  }

  async getAllEventsForApi(): Promise<Event[]> {
    try {
      return await this.eventRepo.findAllForApi();
    } catch (error) {
      this.handleError(error, 'get all events for api');
    }
  }

  async createEvent(data: Partial<Event>): Promise<Event> {
    try {
      this.validateRequired(data, ['name']);

      // Check if event name already exists
      const existing = await this.eventRepo.findByName(data.name!);
      if (existing) {
        throw new Error(`Event with name "${data.name}" already exists`);
      }

      return await this.eventRepo.create(data);
    } catch (error) {
      this.handleError(error, 'create event');
    }
  }

  async updateEvent(id: string, data: Partial<Event>): Promise<Event> {
    try {
      this.validateUUID(id, 'Event ID');

      // If updating name, check for duplicates
      if (data.name) {
        const existing = await this.eventRepo.findByName(data.name);
        if (existing && existing.id !== id) {
          throw new Error(`Event with name "${data.name}" already exists`);
        }
      }

      return await this.eventRepo.update(id, data);
    } catch (error) {
      this.handleError(error, 'update event');
    }
  }

  async deleteEvent(id: string): Promise<void> {
    try {
      this.validateUUID(id, 'Event ID');
      // Its expenses stay, with event_id cleared (ON DELETE SET NULL).
      await this.eventRepo.delete(id);
    } catch (error) {
      this.handleError(error, 'delete event');
    }
  }

}
