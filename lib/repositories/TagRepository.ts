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
   * Find tags by type (shared or personal)
   */
  async findByType(type: 'shared' | 'personal', userId?: string): Promise<Tag[]> {
    const isShared = type === 'shared';

    let query = this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('is_shared', isShared);

    if (type === 'personal' && userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.order('name');

    if (error) {
      throw new Error(`Failed to fetch tags by type: ${error.message}`);
    }

    return (data as unknown as Tag[]) || [];
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

  /**
   * Search tags by name
   */
  async searchByName(searchTerm: string, limit: number = 20): Promise<Tag[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .ilike('name', `%${searchTerm}%`)
      .order('name')
      .limit(limit);

    if (error) {
      throw new Error(`Failed to search tags: ${error.message}`);
    }

    return (data as unknown as Tag[]) || [];
  }

  /**
   * Get popular tags (used most frequently)
   */
  async getPopular(limit: number = 10): Promise<Tag[]> {
    // This would require joining with expense_tags and counting
    // For now, return all tags sorted by name
    // TODO: Implement proper popularity counting
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .order('name')
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch popular tags: ${error.message}`);
    }

    return (data as unknown as Tag[]) || [];
  }
}
