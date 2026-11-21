import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { PortfolioAccountRepository } from '@/lib/repositories/PortfolioAccountRepository';
import {
  buildCardIndex,
  type CardStyle,
  type KnownCard,
  type PaymentSourceCard,
} from '@/lib/expenses/paymentSource';
import type { PortfolioAccount } from '@/types';

/** `portfolio_accounts.type` for a card. A soft FK onto portfolio_account_types.name. */
const CREDIT_CARD_TYPE = 'Credit Card';

/** Trailing digits in an account name: "HDFC Rupay - Bob - 1515" → "1515". */
const NAME_DIGITS = /(\d{3,6})\s*$/;

/**
 * The household's cards, so an expense can say "HDFC Swiggy CC" instead of
 * "HDFC Bank card ••1909".
 *
 * Selavu reading a Selvam table is deliberate: `portfolio_accounts`
 * already holds every card with the name the household actually uses, and duplicating those
 * names into the expense code would leave Selavu stale the moment a card is renamed.
 *
 * **Closed cards are included.** Their past expenses still need naming, and leaving them out
 * would also shift the colours of every card created after them.
 */
export class PaymentSourceService extends BaseService {
  private accounts: PortfolioAccountRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.accounts = new PortfolioAccountRepository(supabase);
  }

  /**
   * Oldest first, which is what keeps colours stable: `buildCardIndex` assigns by position,
   * so a card added today must sort last or it would recolour everything after it.
   */
  async listCards(): Promise<PaymentSourceCard[]> {
    const all = await this.accounts.findSorted(true);
    const cards = all
      .filter((account) => account.type === CREDIT_CARD_TYPE)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));

    const known: KnownCard[] = [];
    for (const account of cards) {
      const last4 = this.last4Of(account);
      if (last4) known.push({ last4, name: account.name });
    }

    const index = buildCardIndex(known);
    return known.map((card) => ({ ...card, ...(index.get(card.last4) as CardStyle) }));
  }

  /**
   * `details.last4`, else the digits the account name ends with.
   *
   * The name fallback is not defensive padding: an account named "HDFC Rupay - Alice - 1234"
   * often has a null `details.last4`, and its card can still be the most-used payment method.
   */
  private last4Of(account: PortfolioAccount): string | null {
    const stored = account.details?.last4;
    if (typeof stored === 'string' && /^\d{3,6}$/.test(stored.trim())) return stored.trim();
    if (typeof stored === 'number' && Number.isInteger(stored)) return String(stored);
    return account.name.match(NAME_DIGITS)?.[1] ?? null;
  }
}
