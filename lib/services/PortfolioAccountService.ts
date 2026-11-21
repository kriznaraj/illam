import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { PortfolioAccountRepository } from '@/lib/repositories/PortfolioAccountRepository';
import type { PortfolioAccount } from '@/types';

export class PortfolioAccountService extends BaseService {
  private repo: PortfolioAccountRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new PortfolioAccountRepository(supabase);
  }

  async list(includeArchived: boolean): Promise<PortfolioAccount[]> {
    try {
      return await this.repo.findSorted(includeArchived);
    } catch (e) {
      this.handleError(e, 'list portfolio accounts');
    }
  }

  async create(data: Partial<PortfolioAccount>): Promise<PortfolioAccount> {
    try {
      if (!data.name || !data.type) {
        throw new Error('Missing required fields: name and type are required');
      }

      return await this.repo.create({
        name: data.name,
        type: data.type,
        notes: data.notes || null,
        currency: data.currency || 'INR',
        unit: data.unit || null,
        multiplier: data.multiplier || null,
        sort_order: (data as any).sort_order || 0,
        details: data.details || null,
      } as any);
    } catch (e) {
      this.handleError(e, 'create portfolio account');
    }
  }

  async update(id: string, patch: Partial<PortfolioAccount>): Promise<PortfolioAccount> {
    try {
      this.validateUUID(id, 'Account ID');
      const updateData: Record<string, unknown> = {};
      if (patch.name !== undefined) updateData.name = patch.name;
      if (patch.type !== undefined) updateData.type = patch.type;
      if (patch.notes !== undefined) updateData.notes = patch.notes || null;
      if (patch.currency !== undefined) updateData.currency = patch.currency || 'INR';
      if (patch.unit !== undefined) updateData.unit = patch.unit || null;
      if (patch.multiplier !== undefined) updateData.multiplier = patch.multiplier || null;
      if ((patch as any).is_active !== undefined) updateData.is_active = (patch as any).is_active;
      // Sent only when changed: the column does not exist until migration 033 is applied.
      if (patch.is_cash !== undefined) updateData.is_cash = patch.is_cash;
      if ((patch as any).sort_order !== undefined) updateData.sort_order = (patch as any).sort_order;
      if (patch.details !== undefined) updateData.details = patch.details || null;
      return await this.repo.update(id, updateData as any);
    } catch (e) {
      this.handleError(e, 'update portfolio account');
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.validateUUID(id, 'Account ID');
      await this.repo.delete(id);
    } catch (e) {
      this.handleError(e, 'delete portfolio account');
    }
  }
}

