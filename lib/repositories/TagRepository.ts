import { BaseRepository } from './BaseRepository';
import { Tag } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Tag Repository
 * Handles all data access for tags
 */
export class TagRepository extends BaseRepository<Tag> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'tags');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async findAllSorted(): Promise<Tag[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .order('name', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch tags: ${error.message}`);
    }

    return (data as unknown as Tag[]) || [];
  }

  /**
   * Find tag by name
   */
  async findByName(name: string): Promise<Tag | null> {
    // Avoid `.single()` because older data might contain duplicates by name.
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('name', name)
      .limit(1);

    if (error) {
      throw new Error(`Failed to find tag by name: ${error.message}`);
    }

    const first = (data as unknown as Tag[] | null)?.[0] ?? null;
    return first;
  }

  /**
   * Find tags for a specific user (personal + shared)
   */
  async findForUser(userId: string): Promise<Tag[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .or(`is_shared.eq.true,and(is_shared.eq.false,user_id.eq.${userId})`)
      .order('name');

    if (error) {
      throw new Error(`Failed to fetch tags for user: ${error.message}`);
    }

    return (data as unknown as Tag[]) || [];
  }

}
