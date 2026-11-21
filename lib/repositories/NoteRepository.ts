import { BaseRepository } from './BaseRepository';
import type { Note } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export class NoteRepository extends BaseRepository<Note> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'notes');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async findForList(filters: { archived: boolean; search?: string; tag?: string }): Promise<Note[]> {
    let query = this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('is_archived', filters.archived)
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false });

    if (filters.search) {
      query = query.or(`title.ilike.%${filters.search}%,content.ilike.%${filters.search}%`);
    }

    if (filters.tag) {
      query = query.contains('tags', [filters.tag]);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch notes: ${error.message}`);
    return (data as unknown as Note[]) || [];
  }
}

