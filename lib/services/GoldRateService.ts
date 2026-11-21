import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { AppConfigRepository } from '@/lib/repositories/AppConfigRepository';

export class GoldRateService extends BaseService {
  private repo: AppConfigRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new AppConfigRepository(supabase);
  }

  async getRates(): Promise<{ rate_22k: number | null; rate_24k: number | null }> {
    try {
      const { data, error } = await this.repo.getKeys(['gold_rate_22k', 'gold_rate_24k']);
      if (error) throw new Error(error.message);
      const map = Object.fromEntries((data ?? []).map((r: any) => [r.key, Number(r.value)]));
      return {
        rate_22k: map['gold_rate_22k'] ?? null,
        rate_24k: map['gold_rate_24k'] ?? null,
      };
    } catch (e) {
      this.handleError(e, 'get gold rates');
    }
  }

  async setRates(params: { rate_22k?: unknown; rate_24k?: unknown }) {
    try {
      const { rate_22k, rate_24k } = params;
      if (rate_22k == null && rate_24k == null) {
        throw new Error('Provide rate_22k and/or rate_24k');
      }
      const now = new Date().toISOString();
      const upserts = [
        ...(rate_22k != null ? [{ key: 'gold_rate_22k', value: String(Number(rate_22k)), updated_at: now }] : []),
        ...(rate_24k != null ? [{ key: 'gold_rate_24k', value: String(Number(rate_24k)), updated_at: now }] : []),
      ];
      const { error } = await this.repo.upsertKeyValues(upserts);
      if (error) throw new Error(error.message);
      return { rate_22k: rate_22k ?? undefined, rate_24k: rate_24k ?? undefined };
    } catch (e) {
      this.handleError(e, 'set gold rates');
    }
  }
}

