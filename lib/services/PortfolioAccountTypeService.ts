import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { PortfolioAccountTypeRepository } from '@/lib/repositories/PortfolioAccountTypeRepository';
import type { PortfolioAccountType } from '@/types';

export class PortfolioAccountTypeService extends BaseService {
  private repo: PortfolioAccountTypeRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new PortfolioAccountTypeRepository(supabase);
  }

  async list(): Promise<PortfolioAccountType[]> {
    try {
      return await this.repo.findAllSorted();
    } catch (e) {
      this.handleError(e, 'list account types');
    }
  }

  async create(data: { name: string; color?: string; show_in_growth?: boolean; is_equity?: boolean }): Promise<PortfolioAccountType> {
    try {
      if (!data.name?.trim()) throw new Error('Name is required');
      return await this.repo.create({
        name: data.name.trim(),
        color: data.color || '#6b7280',
        show_in_growth: !!data.show_in_growth,
        is_equity: !!data.is_equity,
      } as any);
    } catch (e) {
      this.handleError(e, 'create account type');
    }
  }

  async update(id: string, patch: Partial<{ name: string; color: string; show_in_growth: boolean; is_equity: boolean }>) {
    try {
      this.validateUUID(id, 'ID');
      const update: Record<string, unknown> = {};
      if (patch.name !== undefined) update.name = patch.name.trim();
      if (patch.color !== undefined) update.color = patch.color;
      if (patch.show_in_growth !== undefined) update.show_in_growth = patch.show_in_growth;
      if (patch.is_equity !== undefined) update.is_equity = patch.is_equity;
      return await this.repo.update(id, update as any);
    } catch (e) {
      this.handleError(e, 'update account type');
    }
  }

  async delete(params: { id: string; name?: string | null }): Promise<void> {
    try {
      this.validateUUID(params.id, 'ID');
      const name = params.name || '';
      if (name) {
        const inUse = await this.repo.isTypeInUse(name);
        if (inUse) {
          throw new Error('Cannot delete a type that is used by existing accounts');
        }
      }
      await this.repo.delete(params.id);
    } catch (e) {
      this.handleError(e, 'delete account type');
    }
  }
}

