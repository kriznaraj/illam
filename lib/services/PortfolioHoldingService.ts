import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { PortfolioHoldingRepository } from '@/lib/repositories/PortfolioHoldingRepository';
import type { PortfolioHolding, PortfolioInstrumentType } from '@/types';

const VALID_INSTRUMENT_TYPES: readonly PortfolioInstrumentType[] = [
  'nse_stock',
  'bse_stock',
  'mf_nav',
  'us_stock',
  'gold_etf',
  'gold_physical',
  'gold_rate',
  'sgb',
  'bond',
  'nps',
  'manual',
] as const;

export class PortfolioHoldingService extends BaseService {
  private repo: PortfolioHoldingRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new PortfolioHoldingRepository(supabase);
  }

  async getById(id: string): Promise<PortfolioHolding | null> {
    try {
      this.validateUUID(id, 'id');
      return await this.repo.findById(id);
    } catch (e) {
      this.handleError(e, 'get portfolio holding');
    }
  }

  async list(filters: { accountId?: string; includeInactive: boolean }): Promise<PortfolioHolding[]> {
    try {
      if (filters.accountId) this.validateUUID(filters.accountId, 'accountId');
      return await this.repo.findSorted(filters);
    } catch (e) {
      this.handleError(e, 'list portfolio holdings');
    }
  }

  async create(data: Partial<PortfolioHolding>): Promise<PortfolioHolding> {
    try {
      if (!data.account_id || !data.name || !data.identifier?.trim()) {
        throw new Error('account_id, name, and identifier are required');
      }
      this.validateUUID(data.account_id, 'account_id');

      if (data.instrument_type && !VALID_INSTRUMENT_TYPES.includes(data.instrument_type)) {
        throw new Error(`instrument_type must be one of: ${VALID_INSTRUMENT_TYPES.join(', ')}`);
      }

      return await this.repo.create({
        account_id: data.account_id,
        name: data.name.trim(),
        symbol: data.symbol?.trim() || null,
        identifier: data.identifier.trim(),
        instrument_type: data.instrument_type || 'manual',
        quantity_unit: data.quantity_unit?.trim() || null,
        sort_order: data.sort_order ?? 0,
        details: data.details ?? null,
        is_active: data.is_active !== false,
      });
    } catch (e) {
      this.handleError(e, 'create portfolio holding');
    }
  }

  async update(id: string, patch: Partial<PortfolioHolding>): Promise<PortfolioHolding> {
    try {
      this.validateUUID(id, 'id');
      if (patch.instrument_type != null && !VALID_INSTRUMENT_TYPES.includes(patch.instrument_type)) {
        throw new Error(`instrument_type must be one of: ${VALID_INSTRUMENT_TYPES.join(', ')}`);
      }

      const updateData: Partial<PortfolioHolding> = {};
      if (patch.name !== undefined) updateData.name = patch.name.trim();
      if (patch.symbol !== undefined) updateData.symbol = patch.symbol?.trim() || null;
      if (patch.identifier !== undefined) updateData.identifier = patch.identifier.trim();
      if (patch.instrument_type !== undefined) updateData.instrument_type = patch.instrument_type;
      if (patch.quantity_unit !== undefined) updateData.quantity_unit = patch.quantity_unit?.trim() || null;
      if (patch.sort_order !== undefined) updateData.sort_order = patch.sort_order;
      if (patch.details !== undefined) updateData.details = patch.details;
      if (patch.is_active !== undefined) updateData.is_active = patch.is_active;

      return await this.repo.update(id, updateData);
    } catch (e) {
      this.handleError(e, 'update portfolio holding');
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.validateUUID(id, 'id');
      await this.repo.delete(id);
    } catch (e) {
      this.handleError(e, 'delete portfolio holding');
    }
  }
}

