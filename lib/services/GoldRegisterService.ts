import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { GoldRegisterRepository } from '@/lib/repositories/GoldRegisterRepository';

export class GoldRegisterService extends BaseService {
  private repo: GoldRegisterRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new GoldRegisterRepository(supabase);
  }

  async list() {
    try {
      const { data, error } = await this.repo.listAll();
      if (error) throw new Error(error.message);
      return data ?? [];
    } catch (e) {
      this.handleError(e, 'fetch gold register');
    }
  }

  async create(body: any) {
    try {
      const { name, purchased_from, purchased_at, maturity_date, buy_price, gross_weight, gold_weight, notes, item_type } = body ?? {};
      if (!name || gold_weight == null) {
        throw new Error('name and gold_weight are required');
      }
      const { data, error } = await this.repo.insert({
        name,
        purchased_from,
        purchased_at: purchased_at || null,
        maturity_date: maturity_date || null,
        buy_price: buy_price || null,
        gross_weight,
        gold_weight,
        notes,
        item_type: item_type || 'physical',
      });
      if (error) throw new Error(error.message);
      return data;
    } catch (e) {
      this.handleError(e, 'create gold item');
    }
  }

  async update(body: any) {
    try {
      const { id, name, purchased_from, purchased_at, maturity_date, buy_price, gross_weight, gold_weight, notes, item_type } = body ?? {};
      if (!id) throw new Error('id is required');
      const { data, error } = await this.repo.update(String(id), {
        name,
        purchased_from,
        purchased_at: purchased_at || null,
        maturity_date: maturity_date || null,
        buy_price: buy_price || null,
        gross_weight,
        gold_weight,
        notes,
        item_type: item_type || 'physical',
      });
      if (error) throw new Error(error.message);
      return data;
    } catch (e) {
      this.handleError(e, 'update gold item');
    }
  }

  async delete(id: string) {
    try {
      this.validateUUID(id, 'id');
      const { error } = await this.repo.delete(id);
      if (error) throw new Error(error.message);
    } catch (e) {
      this.handleError(e, 'delete gold item');
    }
  }

  async physicalSummary() {
    try {
      const { data, error } = await this.repo.listPhysicalWeights();
      if (error) throw new Error(error.message);
      const total_grams = (data ?? []).reduce((sum: number, item: any) => sum + Number(item.gold_weight || 0), 0);
      return { total_grams, item_count: (data ?? []).length };
    } catch (e) {
      this.handleError(e, 'fetch physical gold summary');
    }
  }
}

