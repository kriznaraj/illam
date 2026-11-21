import { vi } from 'vitest';

export interface QueryResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

export interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * Minimal stand-in for a Supabase query builder.
 *
 * The real builder is chainable and thenable — `.from(t).select(q).eq(...)` is
 * awaited directly, while `.single()` terminates explicitly. This mock mirrors
 * both: every chain method returns the builder, and the result is pulled from
 * the queue at await time rather than at `.from()` time. That ordering matters
 * for retry tests, where the same chain is rebuilt and awaited several times
 * and each attempt must see a different result.
 */
export function createSupabaseMock(results: QueryResult | QueryResult[]) {
  const queue = Array.isArray(results) ? [...results] : [results];
  const calls: RecordedCall[] = [];
  let awaits = 0;

  const next = (): QueryResult => {
    awaits += 1;
    // Last result repeats, so a caller testing "always fails" passes one entry.
    return queue.length > 1 ? (queue.shift() as QueryResult) : queue[0];
  };

  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'is', 'like', 'ilike',
    'or', 'order', 'limit', 'range', 'filter', 'not',
  ];

  const makeBuilder = () => {
    const builder: Record<string, unknown> = {};
    for (const method of chainMethods) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.single = () => {
      calls.push({ method: 'single', args: [] });
      return Promise.resolve(next());
    };
    builder.maybeSingle = () => {
      calls.push({ method: 'maybeSingle', args: [] });
      return Promise.resolve(next());
    };
    // Thenable, so `await builder` resolves like the real PostgREST builder.
    builder.then = (onFulfilled?: any, onRejected?: any) =>
      Promise.resolve(next()).then(onFulfilled, onRejected);
    return builder;
  };

  const from = vi.fn((table: string) => {
    calls.push({ method: 'from', args: [table] });
    return makeBuilder();
  });

  return {
    client: { from } as any,
    from,
    calls,
    /** How many times a chain was actually awaited — i.e. round trips attempted. */
    get awaitCount() {
      return awaits;
    },
    argsFor(method: string) {
      return calls.filter((c) => c.method === method).map((c) => c.args);
    },
  };
}
