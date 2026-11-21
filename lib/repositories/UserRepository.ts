import { BaseRepository } from './BaseRepository';
import { User } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * User Repository
 * Handles all data access for users
 */
export class UserRepository extends BaseRepository<User> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'users');
  }

  protected getSelectQuery(): string {
    return 'id, username, full_name, email, icon, is_active, created_at';
  }

  async findActiveSorted(): Promise<User[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select(this.getSelectQuery())
        .eq('is_active', true)
        .order('full_name', { ascending: true });

      if (res.error && this.isTransientSupabaseError(res.error)) {
        throw res.error;
      }
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch active users: ${error.message}`);
    }

    return (data as unknown as User[]) || [];
  }

  async findActiveById(id: string): Promise<User | null> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select(this.getSelectQuery())
        .eq('is_active', true)
        .eq('id', id)
        .limit(1);

      if (res.error && this.isTransientSupabaseError(res.error)) {
        throw res.error;
      }
      return res;
    });

    if (error) {
      throw new Error(`Failed to find active user: ${error.message}`);
    }

    const first = (data as unknown as User[] | null)?.[0] ?? null;
    return first;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('email', email)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find user by email: ${error.message}`);
    }

    return data as unknown as User;
  }

  /**
   * Find user by username
   */
  async findByUsername(username: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('username', username)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find user by username: ${error.message}`);
    }

    return data as unknown as User;
  }

  /**
   * Search users by name or username
   */
  async search(searchTerm: string, limit: number = 10): Promise<User[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .or(`full_name.ilike.%${searchTerm}%,username.ilike.%${searchTerm}%`)
      .limit(limit);

    if (error) {
      throw new Error(`Failed to search users: ${error.message}`);
    }

    return (data as unknown as User[]) || [];
  }

  /**
   * Get active users (users who have created expenses)
   */
  async getActiveUsers(): Promise<User[]> {
    // This would require joining with expenses
    // For now, return all users
    // TODO: Implement proper active user detection
    return this.findAll();
  }
}
