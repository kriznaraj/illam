import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Migrations are applied by hand in the Supabase SQL editor, so the code ships first and the
 * table appears later. Reads of a table that is not there yet may answer empty; writes must not.
 */
export function isTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message ?? '');
}

/**
 * Base Repository Pattern
 * Abstract class providing common CRUD operations for all repositories
 * Implements the Repository pattern for data access layer
 */
/** An untyped row: the client has no generated database types. */
type Row = Record<string, unknown>;

export abstract class BaseRepository<T> {
  protected supabase: SupabaseClient;
  protected tableName: string;

  constructor(supabase: SupabaseClient, tableName: string) {
    this.supabase = supabase;
    this.tableName = tableName;
  }

  protected isTransientSupabaseError(error: unknown): boolean {
    const msg = (() => {
      if (error instanceof Error) return error.message;
      if (typeof error === 'string') return error;
      // Supabase/PostgREST errors commonly have a `message` field.
      if (error && typeof error === 'object' && 'message' in error) {
        const maybeMessage = (error as { message?: unknown }).message;
        return String(maybeMessage ?? '');
      }
      return String(error ?? '');
    })().toLowerCase();

    return (
      msg.includes('typeerror: fetch failed') ||
      msg.includes('fetch failed') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up') ||
      msg.includes('und_err_connect_timeout') ||
      msg.includes('connect timeout') ||
      msg.includes('etimedout') ||
      msg.includes('timed out') ||
      msg.includes('timeout') ||
      msg.includes('networkerror')
    );
  }

  protected async withRetry<R>(
    fn: () => Promise<R>,
    opts?: { attempts?: number; baseDelayMs?: number; shouldRetry?: (error: unknown) => boolean }
  ): Promise<R> {
    const attempts = Math.max(1, opts?.attempts ?? 3);
    const baseDelayMs = Math.max(0, opts?.baseDelayMs ?? 200);
    const shouldRetry = opts?.shouldRetry ?? ((e: unknown) => this.isTransientSupabaseError(e));

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const retry = attempt < attempts && shouldRetry(error);
        if (!retry) throw error;
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }

    // Unreachable (loop either returns or throws), but keeps TS happy.
    throw new Error('Unreachable retry failure');
  }

  /**
   * Find entity by ID
   */
  async findById(id: string): Promise<T | null> {
    const { data, error } = await this.withRetry(
      async () => {
        const res = await this.supabase
          .from(this.tableName)
          .select(this.getSelectQuery())
          .eq('id', id)
          .single();

        if (res.error && this.isTransientSupabaseError(res.error)) {
          throw res.error;
        }
        return res;
      },
      { shouldRetry: (e) => this.isTransientSupabaseError(e) }
    );

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found
        return null;
      }
      throw new Error(`Failed to find ${this.tableName} by ID: ${error.message}`);
    }

    return data as T;
  }

  /**
   * Find all entities
   */
  async findAll(): Promise<T[]> {
    const { data, error } = await this.withRetry(
      async () => {
        const res = await this.supabase.from(this.tableName).select(this.getSelectQuery());
        if (res.error && this.isTransientSupabaseError(res.error)) {
          throw res.error;
        }
        return res;
      },
      { shouldRetry: (e) => this.isTransientSupabaseError(e) }
    );

    if (error) {
      throw new Error(`Failed to fetch ${this.tableName}: ${error.message}`);
    }

    return (data as T[]) || [];
  }

  /**
   * Create new entity
   */
  async create(entity: Partial<T>): Promise<T> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .insert([entity as Row])
      .select(this.getSelectQuery())
      .single();

    if (error) {
      throw new Error(`Failed to create ${this.tableName}: ${error.message}`);
    }

    return data as T;
  }

  /**
   * Create multiple entities
   */
  async createMany(entities: Partial<T>[]): Promise<T[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .insert(entities as Row[])
      .select(this.getSelectQuery());

    if (error) {
      throw new Error(`Failed to create multiple ${this.tableName}: ${error.message}`);
    }

    return (data as T[]) || [];
  }

  /**
   * Update entity by ID
   */
  async update(id: string, entity: Partial<T>): Promise<T> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .update(entity as Row)
      .eq('id', id)
      .select(this.getSelectQuery())
      .single();

    if (error) {
      throw new Error(`Failed to update ${this.tableName}: ${error.message}`);
    }

    return data as T;
  }

  /**
   * Delete entity by ID
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from(this.tableName).delete().eq('id', id);

    if (error) {
      throw new Error(`Failed to delete ${this.tableName}: ${error.message}`);
    }
  }

  /**
   * Delete multiple entities by IDs
   */
  async deleteMany(ids: string[]): Promise<void> {
    const { error } = await this.supabase.from(this.tableName).delete().in('id', ids);

    if (error) {
      throw new Error(`Failed to delete multiple ${this.tableName}: ${error.message}`);
    }
  }

  /**
   * Count total entities
   */
  async count(): Promise<number> {
    const { count, error } = await this.withRetry(
      async () => {
        const res = await this.supabase
          .from(this.tableName)
          .select('*', { count: 'exact', head: true });
        if (res.error && this.isTransientSupabaseError(res.error)) {
          throw res.error;
        }
        return res;
      },
      { shouldRetry: (e) => this.isTransientSupabaseError(e) }
    );

    if (error) {
      throw new Error(`Failed to count ${this.tableName}: ${error.message}`);
    }

    return count || 0;
  }

  /**
   * Check if entity exists by ID
   */
  async exists(id: string): Promise<boolean> {
    const entity = await this.findById(id);
    return entity !== null;
  }

  /**
   * Find entities with pagination
   */
  async findWithPagination(
    page: number = 1,
    pageSize: number = 50
  ): Promise<{ data: T[]; total: number; page: number; pageSize: number }> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await this.withRetry(
      async () => {
        const res = await this.supabase
          .from(this.tableName)
          .select(this.getSelectQuery(), { count: 'exact' })
          .range(from, to);
        if (res.error && this.isTransientSupabaseError(res.error)) {
          throw res.error;
        }
        return res;
      },
      { shouldRetry: (e) => this.isTransientSupabaseError(e) }
    );

    if (error) {
      throw new Error(`Failed to fetch ${this.tableName} with pagination: ${error.message}`);
    }

    return {
      data: (data as T[]) || [],
      total: count || 0,
      page,
      pageSize,
    };
  }

  /**
   * Abstract method to be implemented by subclasses
   * Defines the select query for this repository
   * Can include joins, nested selects, etc.
   */
  protected abstract getSelectQuery(): string;

  /**
   * Execute raw query
   * Use with caution - prefer using specific methods
   */
  protected async executeRawQuery(query: string): Promise<any> {
    const { data, error } = await this.supabase.rpc(query);

    if (error) {
      throw new Error(`Failed to execute raw query: ${error.message}`);
    }

    return data;
  }
}
