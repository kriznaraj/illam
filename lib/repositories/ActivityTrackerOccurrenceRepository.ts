import { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { ActivityTrackerOccurrence } from '@/types';

export class ActivityTrackerOccurrenceRepository extends BaseRepository<ActivityTrackerOccurrence> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'family_tracker_occurrences');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async findByEventId(eventId: string): Promise<ActivityTrackerOccurrence[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('event_id', eventId)
      .order('occurred_at', { ascending: false });

    if (error) throw error;
    return (data || []) as ActivityTrackerOccurrence[];
  }

  async findByEventIdAndDate(eventId: string, date: string): Promise<ActivityTrackerOccurrence | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('event_id', eventId)
      .eq('occurred_at', date)
      .maybeSingle();

    if (error) throw error;
    return (data as ActivityTrackerOccurrence | null) ?? null;
  }
}
