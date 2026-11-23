import { describe, it, expect, vi } from 'vitest';
import { BaseRepository } from '../BaseRepository';
import { createSupabaseMock } from './supabaseMock';

interface Row {
  id: string;
  name: string;
}

/**
 * BaseRepository is abstract with protected internals. This subclass exposes
 * the retry machinery so it can be tested directly — all 29 repositories
 * inherit it, and a silent regression in transient-error classification would
 * turn a recoverable network blip into a user-facing failure.
 */
class TestRepository extends BaseRepository<Row> {
  protected getSelectQuery(): string {
    return '*';
  }
  public isTransient(error: unknown): boolean {
    return this.isTransientSupabaseError(error);
  }
  public retry<R>(
    fn: () => Promise<R>,
    opts?: { attempts?: number; baseDelayMs?: number; shouldRetry?: (e: unknown) => boolean }
  ): Promise<R> {
    return this.withRetry(fn, opts);
  }
}

const build = (results: Parameters<typeof createSupabaseMock>[0]) => {
  const mock = createSupabaseMock(results);
  return { repo: new TestRepository(mock.client, 'expenses'), mock };
};

describe('isTransientSupabaseError', () => {
  it.each([
    'TypeError: fetch failed',
    'fetch failed',
    'ECONNRESET',
    'socket hang up',
    'UND_ERR_CONNECT_TIMEOUT',
    'connect timeout',
    'ETIMEDOUT',
    'request timed out',
    'timeout of 45000ms exceeded',
    'NetworkError when attempting to fetch',
  ])('classifies %s as transient', (message) => {
    const { repo } = build({});
    expect(repo.isTransient(new Error(message))).toBe(true);
  });

  it('is case-insensitive', () => {
    const { repo } = build({});
    expect(repo.isTransient(new Error('SOCKET HANG UP'))).toBe(true);
  });

  it.each([
    'duplicate key value violates unique constraint',
    'invalid input syntax for type uuid',
    'permission denied for table expenses',
    'JSON object requested, multiple (or no) rows returned',
  ])('classifies %s as permanent', (message) => {
    const { repo } = build({});
    expect(repo.isTransient(new Error(message))).toBe(false);
  });

  it('reads the message off a bare PostgREST error object', () => {
    const { repo } = build({});
    // PostgREST errors are plain objects, not Error instances.
    expect(repo.isTransient({ message: 'fetch failed', code: '' })).toBe(true);
    expect(repo.isTransient({ message: 'duplicate key', code: '23505' })).toBe(false);
  });

  it('handles a raw string', () => {
    const { repo } = build({});
    expect(repo.isTransient('ECONNRESET')).toBe(true);
  });

  it('does not throw on null or undefined', () => {
    const { repo } = build({});
    expect(repo.isTransient(null)).toBe(false);
    expect(repo.isTransient(undefined)).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const { repo } = build({});
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(repo.retry(fn, { baseDelayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and succeeds on a later attempt', async () => {
    const { repo } = build({});
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue('recovered');
    await expect(repo.retry(fn, { baseDelayMs: 0 })).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 attempts by default and rethrows the last error', async () => {
    const { repo } = build({});
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(repo.retry(fn, { baseDelayMs: 0 })).rejects.toThrow('ECONNRESET');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent error', async () => {
    const { repo } = build({});
    const fn = vi.fn().mockRejectedValue(new Error('duplicate key'));
    await expect(repo.retry(fn, { baseDelayMs: 0 })).rejects.toThrow('duplicate key');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours a custom attempt count', async () => {
    const { repo } = build({});
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(repo.retry(fn, { attempts: 5, baseDelayMs: 0 })).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('treats attempts below 1 as a single attempt', async () => {
    const { repo } = build({});
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(repo.retry(fn, { attempts: 0, baseDelayMs: 0 })).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours a custom shouldRetry predicate', async () => {
    const { repo } = build({});
    const fn = vi.fn().mockRejectedValue(new Error('duplicate key'));
    await expect(
      repo.retry(fn, { baseDelayMs: 0, shouldRetry: () => true })
    ).rejects.toThrow('duplicate key');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('backs off progressively between attempts', async () => {
    const { repo } = build({});
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: any, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(cb, 0);
    }) as any);

    const fn = vi.fn().mockRejectedValue(new Error('fetch failed'));
    await expect(repo.retry(fn, { baseDelayMs: 100 })).rejects.toThrow();
    // baseDelay * attempt → 100 then 200; no sleep after the final failure.
    expect(delays).toEqual([100, 200]);
    vi.restoreAllMocks();
  });
});

describe('findById', () => {
  it('returns the row', async () => {
    const { repo } = build({ data: { id: 'a', name: 'Rent' }, error: null });
    await expect(repo.findById('a')).resolves.toEqual({ id: 'a', name: 'Rent' });
  });

  it('returns null for PGRST116 (no rows) rather than throwing', async () => {
    const { repo } = build({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    await expect(repo.findById('missing')).resolves.toBeNull();
  });

  it('throws a message naming the table for other errors', async () => {
    const { repo } = build({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(repo.findById('a')).rejects.toThrow(
      'Failed to find expenses by ID: permission denied'
    );
  });

  it('retries when the query returns a transient error, then succeeds', async () => {
    const { repo, mock } = build([
      { data: null, error: { message: 'fetch failed' } },
      { data: { id: 'a', name: 'Rent' }, error: null },
    ]);
    await expect(repo.findById('a')).resolves.toEqual({ id: 'a', name: 'Rent' });
    expect(mock.awaitCount).toBe(2);
  });

  it('queries by the id column', async () => {
    const { repo, mock } = build({ data: { id: 'a', name: 'Rent' }, error: null });
    await repo.findById('a');
    expect(mock.argsFor('eq')).toContainEqual(['id', 'a']);
  });
});

describe('findAll', () => {
  it('returns rows', async () => {
    const { repo } = build({ data: [{ id: 'a', name: 'Rent' }], error: null });
    await expect(repo.findAll()).resolves.toHaveLength(1);
  });

  it('returns an empty array when data is null', async () => {
    const { repo } = build({ data: null, error: null });
    await expect(repo.findAll()).resolves.toEqual([]);
  });

  it('wraps errors with the table name', async () => {
    const { repo } = build({ data: null, error: { message: 'boom' } });
    await expect(repo.findAll()).rejects.toThrow('Failed to fetch expenses: boom');
  });
});

describe('write operations', () => {
  it('create returns the inserted row', async () => {
    const { repo } = build({ data: { id: 'a', name: 'Rent' }, error: null });
    await expect(repo.create({ name: 'Rent' })).resolves.toEqual({ id: 'a', name: 'Rent' });
  });

  it('create wraps errors', async () => {
    const { repo } = build({ data: null, error: { message: 'duplicate key' } });
    await expect(repo.create({ name: 'Rent' })).rejects.toThrow(
      'Failed to create expenses: duplicate key'
    );
  });

  it('createMany returns an empty array when data is null', async () => {
    const { repo } = build({ data: null, error: null });
    await expect(repo.createMany([{ name: 'a' }])).resolves.toEqual([]);
  });

  it('update wraps errors', async () => {
    const { repo } = build({ data: null, error: { message: 'nope' } });
    await expect(repo.update('a', { name: 'x' })).rejects.toThrow('Failed to update expenses: nope');
  });

  it('delete resolves on success', async () => {
    const { repo } = build({ error: null });
    await expect(repo.delete('a')).resolves.toBeUndefined();
  });

  it('delete wraps errors', async () => {
    const { repo } = build({ error: { message: 'fk violation' } });
    await expect(repo.delete('a')).rejects.toThrow('Failed to delete expenses: fk violation');
  });

  it('deleteMany filters by the id list', async () => {
    const { repo, mock } = build({ error: null });
    await repo.deleteMany(['a', 'b']);
    expect(mock.argsFor('in')).toContainEqual(['id', ['a', 'b']]);
  });
});
