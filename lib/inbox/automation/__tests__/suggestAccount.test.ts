import { describe, expect, it } from 'vitest';
import { suggestAccount, type InvestmentTransferRef } from '../suggestAccount';

const confirmed = (over: Partial<InvestmentTransferRef> & { id: string }): InvestmentTransferRef => ({
  date: '2026-07-31',
  amount: 47500,
  counterparty: 'ALICE',
  payment_method: 'HDFC Bank UPI ••3101',
  account_id: 'acc-us',
  ...over,
});

const target = { id: 'new', amount: 47500, counterparty: 'ALICE', payment_method: 'HDFC Bank UPI ••3101' };

describe('suggestAccount', () => {
  it('suggests where the last payment to the same payee went', () => {
    const suggestion = suggestAccount(target, [
      confirmed({ id: 'old', date: '2026-05-01', account_id: 'acc-wallet' }),
      confirmed({ id: 'recent', date: '2026-07-31', account_id: 'acc-us' }),
    ]);
    expect(suggestion).toEqual({ accountId: 'acc-us', reason: 'the last payment to ALICE (2026-07-31) went there' });
  });

  it('falls back to a similar amount paid the same way, when those all went to one account', () => {
    const payeeless = { ...target, counterparty: null, amount: 47775 };
    expect(suggestAccount(payeeless, [confirmed({ id: 'a', counterparty: null, amount: 47775, date: '2026-08-07' })])).toEqual({
      accountId: 'acc-us',
      reason: 'like ₹47,775 on 2026-08-07',
    });
  });

  it('stays blank when similar transfers went to different accounts', () => {
    const payeeless = { ...target, counterparty: null, amount: 20000 };
    const history = [
      confirmed({ id: 'chit', counterparty: null, amount: 20000, account_id: 'acc-gold-chit' }),
      confirmed({ id: 'kite', counterparty: null, amount: 20000, account_id: 'acc-kite-bob' }),
    ];
    expect(suggestAccount(payeeless, history)).toBeNull();
  });

  it('ignores the transfer itself and ones with no account', () => {
    expect(suggestAccount(target, [confirmed({ id: 'new' }), confirmed({ id: 'x', account_id: null })])).toBeNull();
  });
});
