import { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { ActivityTrackerEvent, ActivityTrackerEventType, ActivityTrackerStatus } from '@/types';

export class ActivityTrackerRepository extends BaseRepository<ActivityTrackerEvent> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'family_tracker_events');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async findFiltered(filters: {
    event_type?: ActivityTrackerEventType;
    status?: ActivityTrackerStatus;
    history?: boolean;
  }): Promise<ActivityTrackerEvent[]> {
    let query = this.supabase.from(this.tableName).select('*');

    if (filters.event_type) {
      query = query.eq('event_type', filters.event_type);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.history) {
      query = query.eq('status', 'closed');
      query = query.order('event_date', { ascending: false });
    } else {
      query = query.order('event_date', { ascending: true });
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as ActivityTrackerEvent[];
  }

  async findOpenAnnualPastDue(today: string): Promise<ActivityTrackerEvent[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('event_type', 'annual')
      .eq('status', 'open')
      .lt('event_date', today);

    if (error) throw error;
    return (data || []) as ActivityTrackerEvent[];
  }
}
