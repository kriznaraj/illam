import { BaseRepository } from './BaseRepository';
import { Event } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Event Repository
 * Handles all data access for expense events
 */
export class EventRepository extends BaseRepository<Event> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'expense_events');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  /**
   * Find event by name
   */
  async findByName(name: string): Promise<Event | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('name', name)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find event by name: ${error.message}`);
    }

    return data as unknown as Event;
  }

  /**
   * Find events sorted by name
   */
  async findAllSorted(): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .order('name', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch sorted events: ${error.message}`);
    }

    return (data as unknown as Event[]) || [];
  }

  async findAllForApi(): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch events: ${error.message}`);
    }

    return (data as unknown as Event[]) || [];
  }

  /**
   * Search events by name
   */
  async searchByName(searchTerm: string, limit: number = 20): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .ilike('name', `%${searchTerm}%`)
      .order('name')
      .limit(limit);

    if (error) {
      throw new Error(`Failed to search events: ${error.message}`);
    }

    return (data as unknown as Event[]) || [];
  }

  /**
   * Find active events (if you add an active/inactive flag later)
   */
  async findActive(): Promise<Event[]> {
    // For now, return all events
    // TODO: Add active/inactive flag to events table
    return this.findAllSorted();
  }
}
