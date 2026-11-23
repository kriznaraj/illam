import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { IncomeRepository } from '@/lib/repositories/IncomeRepository';
import { InboxRepository } from '@/lib/repositories/InboxRepository';
import { monthKeys } from '@/lib/utils/dateUtils';
import type { Income, IncomeKind, IncomeWithUser } from '@/types';

export const INCOME_KINDS: readonly IncomeKind[] = [
  'salary',
  'dividend',
  'interest',
  'refund',
  'reimbursement',
  'rent',
  'gift',
  'other',
];

export const INCOME_KIND_LABEL: Record<IncomeKind, string> = {
  salary: 'Salary',
  dividend: 'Dividend',
  interest: 'Interest',
  refund: 'Refund',
  reimbursement: 'Reimbursement',
  rent: 'Rent',
  gift: 'Gift',
  other: 'Other',
};

/** A month of income, split by currency because a USD dividend cannot be added to rupees. */
export interface IncomeSummary {
  month: string;
  /** Currency code → total received. INR is always present, even at zero. */
  totals: Record<string, number>;
  byKind: { kind: IncomeKind; currency: string; amount: number; count: number }[];
  count: number;
}

/**
 * Income.
 *
 * Totals are grouped by currency and never converted. The six live dividends are USD paid
 * inside the INDmoney wallet; turning them into rupees here would need a rate this app does
 * not hold, and would put an invented figure on record.
 */
export class IncomeService extends BaseService {
  private income: IncomeRepository;
  private inbox: InboxRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.income = new IncomeRepository(supabase);
    this.inbox = new InboxRepository(supabase);
  }

  async listByMonth(month: string): Promise<IncomeWithUser[]> {
    if (!monthKeys.isValid(month)) throw new Error('month must be yyyy-MM');
    const [year, m] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return this.income.findByDateRange(`${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`);
  }

  summarise(rows: IncomeWithUser[], month: string): IncomeSummary {
    const totals: Record<string, number> = { INR: 0 };
    const byKindMap = new Map<string, { kind: IncomeKind; currency: string; amount: number; count: number }>();

    for (const row of rows) {
      // Money awaiting a decision is not money earned yet — same rule as needs_review expenses.
      if (row.needs_review) continue;
      const currency = row.currency || 'INR';
      const amount = Number(row.amount) || 0;
      totals[currency] = (totals[currency] ?? 0) + amount;

      const key = `${row.kind}|${currency}`;
      const existing = byKindMap.get(key);
      if (existing) {
        existing.amount += amount;
        existing.count += 1;
      } else {
        byKindMap.set(key, { kind: row.kind, currency, amount, count: 1 });
      }
    }

    return {
      month,
      totals,
      byKind: [...byKindMap.values()].sort((a, b) => b.amount - a.amount),
      count: rows.filter((row) => !row.needs_review).length,
    };
  }

  async create(input: Partial<Income>): Promise<Income> {
    this.validateRequired(input as Record<string, unknown>, ['date', 'amount', 'kind', 'user_id']);
    this.validateDate(input.date as string, 'date');
    this.validatePositiveNumber(Number(input.amount), 'amount');
    this.validateUUID(input.user_id as string, 'user_id');
    const kind = input.kind as IncomeKind;
    if (!INCOME_KINDS.includes(kind)) throw new Error(`kind must be one of ${INCOME_KINDS.join(', ')}`);
    if (input.account_id) this.validateUUID(input.account_id, 'account_id');

    return this.income.create({
      date: input.date,
      amount: Number(input.amount),
      currency: (input.currency || 'INR').toUpperCase(),
      kind,
      source_name: input.source_name ?? null,
      description: input.description ?? null,
      user_id: input.user_id,
      account_id: input.account_id ?? null,
      inbox_item_id: input.inbox_item_id ?? null,
      ...(input.statement_ref ? { statement_ref: input.statement_ref } : {}),
      source: input.source ?? 'manual',
      needs_review: input.needs_review ?? false,
      note: input.note ?? null,
    });
  }

  async update(id: string, changes: Partial<Income>): Promise<Income> {
    this.validateUUID(id, 'id');
    if (changes.amount !== undefined) this.validatePositiveNumber(Number(changes.amount), 'amount');
    if (changes.date !== undefined) this.validateDate(changes.date, 'date');
    if (changes.kind !== undefined && !INCOME_KINDS.includes(changes.kind)) {
      throw new Error(`kind must be one of ${INCOME_KINDS.join(', ')}`);
    }
    return this.income.update(id, changes);
  }

  /**
   * Delete a record, and release the alert it came from.
   *
   * Without the second half the alert keeps its `consumed` pointing at a row that no longer
   * exists: Madal goes on saying "Recorded under Income in Selavu", the record sheet never
   * comes back, and the credit can never be filed again — the same trap "Not an expense"
   * avoids by clearing the item when it deletes an auto-added expense. Clearing is best-effort:
   * the deletion the person asked for has already happened, and failing here would report it as
   * unsuccessful.
   */
  async remove(id: string): Promise<void> {
    this.validateUUID(id, 'id');
    const row = await this.income.findById(id);
    await this.income.delete(id);
    if (!row?.inbox_item_id) return;
    try {
      await this.inbox.updateItem(row.inbox_item_id, { consumed: null });
    } catch (error) {
      this.warn('IncomeService.remove', `could not release alert ${row.inbox_item_id}`, error);
    }
  }

  /**
   * Record a credit an alert carried. Idempotent on `inbox_item_id`: the two Gmail accounts
   * sync independently and a run cut short is retried, so the existing row is returned rather
   * than a second one inserted.
   */
  async recordFromInbox(input: Partial<Income> & { inbox_item_id: string }): Promise<Income> {
    const existing = await this.income.findByInboxItem(input.inbox_item_id);
    if (existing) return existing;
    return this.create({ ...input, source: 'inbox' });
  }
}
