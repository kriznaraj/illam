import { BaseRepository } from './BaseRepository';
import { Category } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Category Repository
 * Handles all data access for categories
 */
export class CategoryRepository extends BaseRepository<Category> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'categories');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  /**
   * Find all categories sorted by sort_order
   */
  async findAllSorted(): Promise<Category[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .order('sort_order', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch sorted categories: ${error.message}`);
    }

    return (data as unknown as Category[]) || [];
  }

  /**
   * Update sort order for a category
   */
  async updateSortOrder(categoryId: string, newSortOrder: number): Promise<Category> {
    return this.update(categoryId, { sort_order: newSortOrder } as Partial<Category>);
  }

  /**
   * Find category by name
   */
  async findByName(name: string): Promise<Category | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('name', name)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find category by name: ${error.message}`);
    }

    return data as unknown as Category;
  }

  /**
   * Get all unique group names
   */
  async getUniqueGroups(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('group_name')
      .order('group_name');

    if (error) {
      throw new Error(`Failed to fetch unique groups: ${error.message}`);
    }

    const groups = [...new Set(data?.map((item: { group_name: string }) => item.group_name))];
    return groups;
  }
}
