import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { PortfolioSnapshotRepository } from '@/lib/repositories/PortfolioSnapshotRepository';
import { PortfolioAccountTypeRepository } from '@/lib/repositories/PortfolioAccountTypeRepository';
import { isLiabilityType, normalizeSnapshotAmount } from '@/lib/portfolio/liabilities';
import type { PortfolioSnapshot } from '@/types';

export class PortfolioSnapshotService extends BaseService {
  private repo: PortfolioSnapshotRepository;
  private typeRepo: PortfolioAccountTypeRepository;
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    super();
    this.supabase = supabase;
    this.repo = new PortfolioSnapshotRepository(supabase);
    this.typeRepo = new PortfolioAccountTypeRepository(supabase);
  }

  /**
   * Liability balances (credit cards, loans) must reach the database negative —
   * every net-worth figure is a plain `sum(amount)`, including two RPCs that exist
   * only in the database, so this is the one place the sign can be guaranteed.
   *
   * Callers legitimately supply a positive number: the statement sync on
   * `/portfolio/snapshots` passes `credit_card_statements.statement_amount`, which
   * is always positive, and that is exactly how every card balance from 2026-01
   * onwards ended up adding its debt to net worth instead of subtracting it.
   *
   * See lib/portfolio/liabilities.ts.
   */
  private async normalizeAmountForAccount(accountId: string, amount: number): Promise<number> {
    const { data, error } = await this.supabase
      .from('portfolio_accounts')
      .select('type')
      .eq('id', accountId)
      .single();

    if (error) throw new Error(`Failed to resolve account for snapshot: ${error.message}`);

    const liabilityTypes = await this.typeRepo.findLiabilityTypeNames();
    return normalizeSnapshotAmount(amount, isLiabilityType((data as { type: string } | null)?.type, liabilityTypes));
  }

  async list(filters: { accountId?: string; startDate?: string; endDate?: string; limit: number }): Promise<PortfolioSnapshot[]> {
    try {
      if (filters.accountId) this.validateUUID(filters.accountId, 'accountId');
      return await this.repo.findSorted(filters);
    } catch (e) {
      this.handleError(e, 'list portfolio snapshots');
    }
  }

  async upsert(data: { account_id: string; snapshot_date: string; amount: number; units?: number | null }): Promise<PortfolioSnapshot> {
    try {
      if (!data.account_id || !data.snapshot_date || data.amount === undefined) {
        throw new Error('Missing required fields: account_id, snapshot_date, and amount are required');
      }
      this.validateUUID(data.account_id, 'account_id');

      const { data: row, error } = await this.repo.upsertByAccountMonth({
        account_id: data.account_id,
        snapshot_date: data.snapshot_date,
        amount: await this.normalizeAmountForAccount(data.account_id, data.amount),
        units: data.units ?? null,
      });

      if (error) throw new Error(error.message);
      return row as unknown as PortfolioSnapshot;
    } catch (e) {
      this.handleError(e, 'create/update portfolio snapshot');
    }
  }

  async update(id: string, patch: Partial<{ account_id: string; snapshot_date: string; amount: number }>): Promise<PortfolioSnapshot> {
    try {
      this.validateUUID(id, 'Snapshot ID');
      const updateData: Record<string, unknown> = {};
      if (patch.account_id !== undefined) updateData.account_id = patch.account_id;
      if (patch.snapshot_date !== undefined) updateData.snapshot_date = patch.snapshot_date;
      if (patch.amount !== undefined) {
        // The account may be moving in this same patch; the new owner decides the sign.
        const accountId = patch.account_id ?? (await this.repo.findById(id))?.account_id;
        updateData.amount = accountId
          ? await this.normalizeAmountForAccount(accountId, patch.amount)
          : patch.amount;
      }
      return await this.repo.update(id, updateData as any);
    } catch (e) {
      this.handleError(e, 'update portfolio snapshot');
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.validateUUID(id, 'Snapshot ID');
      await this.repo.delete(id);
    } catch (e) {
      this.handleError(e, 'delete portfolio snapshot');
    }
  }
}

