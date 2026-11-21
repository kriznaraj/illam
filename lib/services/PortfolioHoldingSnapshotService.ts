import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { PortfolioHoldingSnapshotRepository } from '@/lib/repositories/PortfolioHoldingSnapshotRepository';
import type { PortfolioHoldingSnapshot } from '@/types';

export class PortfolioHoldingSnapshotService extends BaseService {
  private repo: PortfolioHoldingSnapshotRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new PortfolioHoldingSnapshotRepository(supabase);
  }

  async list(filters: {
    holdingId?: string;
    accountId?: string;
    snapshotDate?: string;
    startDate?: string;
    endDate?: string;
    limit: number;
  }): Promise<PortfolioHoldingSnapshot[]> {
    try {
      if (filters.holdingId) this.validateUUID(filters.holdingId, 'holdingId');
      if (filters.accountId) this.validateUUID(filters.accountId, 'accountId');

      if (filters.accountId && !filters.holdingId) {
        const { data: holdings, error } = await this.repo.listHoldingIdsForAccount(filters.accountId);
        if (error) throw new Error(error.message);
        const holdingIds = (holdings ?? []).map((h: any) => h.id);
        if (holdingIds.length === 0) return [];

        const { data, error: snapsError } = await this.repo.listSnapshots({
          holdingIds,
          snapshotDate: filters.snapshotDate,
          startDate: filters.startDate,
          endDate: filters.endDate,
          limit: filters.limit,
        });
        if (snapsError) throw new Error(snapsError.message);
        return (data as unknown as PortfolioHoldingSnapshot[]) || [];
      }

      const { data, error } = await this.repo.listSnapshots({
        holdingId: filters.holdingId,
        snapshotDate: filters.snapshotDate,
        startDate: filters.startDate,
        endDate: filters.endDate,
        limit: filters.limit,
      });
      if (error) throw new Error(error.message);
      return (data as unknown as PortfolioHoldingSnapshot[]) || [];
    } catch (e) {
      this.handleError(e, 'list holding snapshots');
    }
  }

  async upsert(data: {
    holding_id: string;
    snapshot_date: string;
    quantity?: number;
    unit_amount?: number | null;
    amount?: number;
  }) {
    try {
      if (!data.holding_id || !data.snapshot_date) {
        throw new Error('holding_id and snapshot_date are required');
      }
      this.validateUUID(data.holding_id, 'holding_id');

      if (data.amount === undefined && (data.quantity === undefined || data.unit_amount === undefined)) {
        throw new Error('Either amount or both quantity and unit_amount are required');
      }

      const computedAmount =
        data.amount !== undefined ? Number(data.amount) : Number(data.quantity) * Number(data.unit_amount);

      const { data: row, error } = await this.repo.upsertSnapshot({
        holding_id: data.holding_id,
        snapshot_date: data.snapshot_date,
        quantity: data.quantity !== undefined ? Number(data.quantity) : 0,
        unit_amount: data.unit_amount != null ? Number(data.unit_amount) : null,
        amount: computedAmount,
      });

      if (error) throw new Error(error.message);
      return row;
    } catch (e) {
      this.handleError(e, 'save holding snapshot');
    }
  }
}

