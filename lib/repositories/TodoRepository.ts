import { BaseRepository } from './BaseRepository';
import type { Todo } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export class TodoRepository extends BaseRepository<Todo> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'todos');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async findForList(filters: { status?: string; priority?: string }): Promise<Todo[]> {
    let query = this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .order('created_at', { ascending: false });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.priority) query = query.eq('priority', filters.priority);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch todos: ${error.message}`);
    return (data as unknown as Todo[]) || [];
  }
}

