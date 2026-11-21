import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { InboxConsumed, InboxItem, InboxKind, InboxOwner, InboxView } from '@/types';

/** Everything ingestion writes. `status` and `consumed` belong to the user and to follow-ups. */
export type InboxItemWrite = Omit<InboxItem, 'id' | 'status' | 'consumed' | 'created_at' | 'updated_at'>;

export interface InboxListFilter {
  view: InboxView;
  owner?: InboxOwner;
  /** Cursor: only items received strictly before this ISO timestamp. */
  before?: string;
  limit: number;
  /**
   * Items the caller knows are still waiting on a person for a reason this table cannot
   * see — the alert behind every transfer still `needs_review`, and behind every auto-added
   * expense automation could not place. Only read by the `todo` view. `InboxService.list`
   * resolves them; see the note on `applyView`.
   */
  openItemIds?: readonly string[];
  /**
   * Flagged items whose work is already done somewhere this table cannot see — a card
   * statement since paid. Kept out of the `todo` view.
   */
  settledItemIds?: readonly string[];
  /** Today in Asia/Kolkata (yyyy-MM-dd): a card bill is work only once its due date has passed unpaid. */
  today?: string;
}

/**
 * How many open-work ids are worth putting in a URL. PostgREST takes them as a query
 * parameter, so an unbounded list eventually meets a header limit rather than an error
 * that says what happened. Open transfers normally number a few dozen at most, far below
 * the ceiling; past it the oldest simply page in behind the rest.
 */
const MAX_OPEN_IDS = 200;

/**
 * The To-do view starts here: anything older is ignored.
 * Whatever was left open before it is history nobody will act on, and it was burying the
 * handful of things that are current. The rows are untouched and still in Money and All.
 */
export const TODO_FROM = '2026-09-01T00:00:00+05:30';

/**
 * Only decisions belong in the To-do (the rule: no manual action item unless Claude couldn't
 * resolve it). A card bill is not one — paying it is detected — until its due
 * date passes with no payment seen. A notice (KYC, a limit change) is not one either: it is an
 * errand outside the app, so it is listed under Heads-up and never counted. A transaction's
 * ingest flag ("Large debit") is not work; what automation could not settle arrives through
 * `openItemIds`.
 */
export const TODO_FLAGGED_KINDS: readonly InboxKind[] = ['card_statement'];

/** How a statement's contradiction flag starts (StatementCaptureService) — that one is work, not news. */
export const CONTRADICTION_PREFIX = 'Statement says';

/** How far back Heads-up looks: a notice is news, and news goes stale. */
export const HEADSUP_DAYS = 30;

/**
 * Which rows a view is made of.
 *
 * `todo` is the only one that is not a plain column filter, and that is the point of it.
 * The view it replaced was `needs_attention = true`, a boolean written once at ingest
 * behind a 7-day freshness gate (`lib/inbox/attention.ts`, which is right about what it
 * does: it exists so the first 90-day backfill does not bury the inbox). But open work
 * does not expire — most transfers awaiting classification can age past the gate and
 * become reachable from no view at all, including large ones such as an income-tax payment
 * or a brokerage deposit. So membership is derived per request from the
 * three things that actually mean "unfinished": the ingest-time flag, a statement that
 * failed to read, and an alert whose transfer is still `needs_review`.
 */
function applyView<Q extends {
  eq: (column: string, value: unknown) => Q;
  gte: (column: string, value: unknown) => Q;
  not: (column: string, operator: string, value: unknown) => Q;
  in: (column: string, values: readonly string[]) => Q;
  neq: (column: string, value: unknown) => Q;
  or: (filters: string) => Q;
}>(query: Q, filter: InboxListFilter): Q {
  switch (filter.view) {
    case 'todo': {
      const openIds = (filter.openItemIds ?? []).slice(0, MAX_OPEN_IDS);
      const settledIds = (filter.settledItemIds ?? []).slice(0, MAX_OPEN_IDS);
      const today = filter.today ?? new Date().toISOString().slice(0, 10);
      const clauses = [
        // Paid bills are removed below (settledItemIds); this keeps only the overdue ones.
        `and(needs_attention.eq.true,kind.eq.card_statement,data->>dueDate.lt.${today})`,
        'consumed->>action.eq.statement_unread',
        // A statement contradicting a filing that could not be refiled automatically.
        `and(needs_attention.eq.true,kind.eq.notice,attention_reason.like.${CONTRADICTION_PREFIX}*)`,
      ];
      if (openIds.length > 0) clauses.push(`id.in.(${openIds.join(',')})`);
      const todo = query.eq('status', 'new').gte('received_at', TODO_FROM).or(clauses.join(','));
      return settledIds.length > 0 ? todo.not('id', 'in', `(${settledIds.join(',')})`) : todo;
    }
    case 'headsup': {
      const since = new Date(Date.now() - HEADSUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
      return query
        .eq('status', 'new')
        .eq('needs_attention', true)
        .eq('kind', 'notice')
        .gte('received_at', since)
        .not('attention_reason', 'like', `${CONTRADICTION_PREFIX}%`);
    }
    // A trade is money moving as much as a card spend is, so it belongs with them rather
    // than in with the newsletters.
    case 'money':
      return query.in('kind', ['transaction', 'trade']).neq('status', 'dismissed');
    case 'statements':
      return query.in('kind', ['card_statement', 'investment_statement']).neq('status', 'dismissed');
    case 'all':
      return query.neq('status', 'dismissed');
  }
}

export class InboxRepository extends BaseRepository<InboxItem> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'inbox_items');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  /**
   * Insert, or refresh the extracted fields of a message seen before.
   *
   * The payload deliberately carries no `status`: on insert the column default
   * (`new`) applies, and on conflict PostgREST only merges the columns sent —
   * so a message the Apps Script delivers twice never un-does "done".
   * Not retried: the upsert is idempotent, but the script retries on its next
   * run anyway, which is the cheaper place for it.
   */
  async upsertByMessage(row: InboxItemWrite): Promise<InboxItem> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .upsert(row, { onConflict: 'owner,gmail_message_id' })
      .select(this.getSelectQuery())
      .single();

    if (error) {
      throw new Error(`Failed to save inbox item: ${error.message}`);
    }
    return data as unknown as InboxItem;
  }

  async list(filter: InboxListFilter): Promise<InboxItem[]> {
    const { data, error } = await this.withRetry(async () => {
      let query = this.supabase
        .from(this.tableName)
        .select(this.getSelectQuery())
        .order('received_at', { ascending: false })
        .limit(filter.limit);

      query = applyView(query, filter);
      if (filter.owner) query = query.eq('owner', filter.owner);
      if (filter.before) query = query.lt('received_at', filter.before);

      const res = await query;
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch inbox items: ${error.message}`);
    }
    return (data ?? []) as unknown as InboxItem[];
  }

  /** Items by id — the alerts behind transfers still waiting, so they can be decided again. */
  async findByIds(ids: readonly string[]): Promise<InboxItem[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase.from(this.tableName).select(this.getSelectQuery()).in('id', ids as string[]);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });
    if (error) {
      throw new Error(`Failed to fetch inbox items: ${error.message}`);
    }
    return (data ?? []) as unknown as InboxItem[];
  }

  /**
   * When each statement from these sources arrived — items that carried an attachment,
   * minus alerts and trades (one ICICI address sends both) — for the late-statement check.
   */
  async listStatementArrivals(sources: readonly string[], sinceIso: string): Promise<Pick<InboxItem, 'owner' | 'source' | 'kind' | 'received_at' | 'attachment_names'>[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('owner, source, kind, received_at, attachment_names')
        .in('source', sources as string[])
        .gte('received_at', sinceIso)
        .not('kind', 'in', '(transaction,trade)')
        .order('received_at', { ascending: true })
        .limit(2000);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch statement arrivals: ${error.message}`);
    }
    return ((data ?? []) as unknown as Pick<InboxItem, 'owner' | 'source' | 'kind' | 'received_at' | 'attachment_names'>[]).filter(
      (row) => Array.isArray(row.attachment_names) && row.attachment_names.length > 0
    );
  }

  /** Transaction alerts received in a window (ISO timestamps, inclusive), for statement reconciliation. */
  async listTransactionsBetween(fromIso: string, toIso: string): Promise<InboxItem[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select(this.getSelectQuery())
        .eq('kind', 'transaction')
        .gte('received_at', fromIso)
        .lte('received_at', toIso)
        .order('received_at', { ascending: true })
        .limit(2000);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch transaction alerts: ${error.message}`);
    }
    return (data ?? []) as unknown as InboxItem[];
  }

  /** Items automation has not acted on yet, oldest first. */
  async listUnconsumed(kind: InboxKind, limit = 500): Promise<InboxItem[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select(this.getSelectQuery())
        .eq('kind', kind)
        .is('consumed', null)
        .order('received_at', { ascending: true })
        .limit(limit);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch unprocessed inbox items: ${error.message}`);
    }
    return (data ?? []) as unknown as InboxItem[];
  }

  /**
   * Record what automation did, once. The `consumed is null` guard makes a
   * second, overlapping run a no-op rather than a double application; the return
   * value says whether this call won.
   */
  async markConsumed(
    id: string,
    consumed: InboxConsumed,
    attention?: { needs_attention: boolean; attention_reason: string | null }
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .update({ consumed, ...(attention ?? {}) })
      .eq('id', id)
      .is('consumed', null)
      .select('id');

    if (error) {
      throw new Error(`Failed to mark inbox item processed: ${error.message}`);
    }
    return Array.isArray(data) && data.length > 0;
  }

  /**
   * Patch one item, retrying transient failures. Safe to retry because the same
   * patch applied twice leaves the same row — statement recording lost writes to
   * a one-off Supabase "Gateway Timeout" before this.
   */
  async updateItem(id: string, patch: Partial<InboxItem>): Promise<void> {
    const { error } = await this.withRetry(async () => {
      const res = await this.supabase.from(this.tableName).update(patch).eq('id', id);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to update inbox item: ${error.message}`);
    }
  }

  /** Overwrite `consumed` after a user decision (e.g. a transfer reclassified as an expense). */
  async updateConsumed(
    id: string,
    consumed: InboxConsumed,
    attention?: { needs_attention: boolean; attention_reason: string | null }
  ): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .update({ consumed, ...(attention ?? {}) })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to update inbox item: ${error.message}`);
    }
  }

  async clearAttention(id: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .update({ needs_attention: false, attention_reason: null })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to clear inbox attention: ${error.message}`);
    }
  }

  /**
   * Card statements still flagged in the To-do window, with the statement each one recorded —
   * so the caller can drop the ones already paid.
   */
  async listFlaggedStatementItems(): Promise<{ id: string; statementId: string }[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('id, consumed')
        .eq('kind', 'card_statement')
        .eq('status', 'new')
        .eq('needs_attention', true)
        .gte('received_at', TODO_FROM)
        .limit(MAX_OPEN_IDS);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch flagged statements: ${error.message}`);
    }
    return ((data ?? []) as unknown as Pick<InboxItem, 'id' | 'consumed'>[])
      .filter((row) => Boolean(row.consumed?.statement_id))
      .map((row) => ({ id: row.id, statementId: String(row.consumed?.statement_id) }));
  }

  /** How many items the To-do view holds — the same definition, counted rather than listed. */
  async countOpenWork(
    work: Pick<InboxListFilter, 'openItemIds' | 'settledItemIds' | 'today'>,
    owner?: InboxOwner
  ): Promise<number> {
    const { count, error } = await this.withRetry(async () => {
      let query = this.supabase.from(this.tableName).select('id', { count: 'exact', head: true });
      query = applyView(query, { view: 'todo', limit: 1, ...work });
      if (owner) query = query.eq('owner', owner);

      const res = await query;
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to count inbox items: ${error.message}`);
    }
    return count ?? 0;
  }
}
