import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, isTableMissing } from './BaseRepository';
import type { Commitment, CommitmentPayment } from '@/types';

const asCommitment = (row: Commitment): Commitment => ({ ...row, amount: Number(row.amount), due_day: Number(row.due_day) });
const asPayment = (row: CommitmentPayment): CommitmentPayment => ({ ...row, amount: Number(row.amount) });

/**
 * Commitments (migration 037). Reads answer empty until the migration is applied — every
 * caller that matches debits against them runs inside ingest or automation, and must carry
 * on as it did before; writes fail loudly.
 */
export class CommitmentRepository extends BaseRepository<Commitment> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'commitments');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async listAll(): Promise<Commitment[]> {
    return this.withRetry(async () => {
      const { data, error } = await this.supabase.from(this.tableName).select('*').order('created_at');
      if (isTableMissing(error)) return [];
      if (error && this.isTransientSupabaseError(error)) throw error;
      if (error) throw new Error(`Failed to fetch commitments: ${error.message}`);
      return ((data ?? []) as unknown as Commitment[]).map(asCommitment);
    });
  }
}

export class CommitmentPaymentRepository extends BaseRepository<CommitmentPayment> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'commitment_payments');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  /** Payments for due months in [fromMonth, toMonth] (yyyy-MM). */
  async listBetween(fromMonth: string, toMonth: string): Promise<CommitmentPayment[]> {
    return this.withRetry(async () => {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .gte('due_month', fromMonth)
        .lte('due_month', toMonth);
      if (isTableMissing(error)) return [];
      if (error && this.isTransientSupabaseError(error)) throw error;
      if (error) throw new Error(`Failed to fetch commitment payments: ${error.message}`);
      return ((data ?? []) as unknown as CommitmentPayment[]).map(asPayment);
    });
  }

  async listForCommitment(commitmentId: string): Promise<CommitmentPayment[]> {
    return this.withRetry(async () => {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('commitment_id', commitmentId)
        .order('due_month', { ascending: false });
      if (isTableMissing(error)) return [];
      if (error && this.isTransientSupabaseError(error)) throw error;
      if (error) throw new Error(`Failed to fetch commitment payments: ${error.message}`);
      return ((data ?? []) as unknown as CommitmentPayment[]).map(asPayment);
    });
  }

  /**
   * Record a payment unless that due month already has one. Not retried: the unique
   * (commitment_id, due_month) makes a duplicate an error, read as "already recorded" —
   * a statement re-read and the alert for the same debit both land here.
   */
  async recordOnce(payment: Omit<CommitmentPayment, 'id' | 'created_at'>): Promise<{ payment: CommitmentPayment; created: boolean }> {
    const { data, error } = await this.supabase.from(this.tableName).insert([payment]).select('*').single();
    if (!error) return { payment: asPayment(data as unknown as CommitmentPayment), created: true };
    if (!/duplicate key/i.test(error.message)) throw new Error(`Failed to record commitment payment: ${error.message}`);
    const { data: existing, error: readError } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('commitment_id', payment.commitment_id)
      .eq('due_month', payment.due_month)
      .single();
    if (readError) throw new Error(`Failed to read commitment payment: ${readError.message}`);
    return { payment: asPayment(existing as unknown as CommitmentPayment), created: false };
  }
}
