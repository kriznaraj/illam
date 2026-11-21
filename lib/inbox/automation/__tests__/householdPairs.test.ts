import { describe, it, expect } from 'vitest';
import { findHouseholdPairs } from '../householdPairs';
import type { Transfer } from '@/types';

let seq = 0;
const transfer = (over: Partial<Transfer>): Transfer => ({
  id: `t${++seq}`,
  inbox_item_id: null,
  owner: 'alice',
  date: '2026-10-07',
  amount: 40000,
  direction: 'debit',
  counterparty: null,
  payment_method: null,
  kind: 'other',
  account_id: null,
  portfolio_investment_id: null,
  credit_card_statement_id: null,
  expense_id: null,
  note: null,
  status: 'needs_review',
  created_at: `2026-10-06T18:${String(40 + seq).padStart(2, '0')}:00Z`,
  updated_at: '2026-10-06T18:40:00Z',
  ...over,
});

describe('findHouseholdPairs', () => {
  // 7 Oct 2026: two ₹40,000 NEFTs out of Alice's ••3101, one ₹40,000 into Bob's Kotak.
  it('pairs a debit from one owner with the same credit to the other, once', () => {
    const first = transfer({});
    const second = transfer({});
    const credit = transfer({ owner: 'bob', direction: 'credit' });
    const pairs = findHouseholdPairs([first, second, credit]);
    expect(pairs).toEqual([{ debit: first, credit }]);
  });

  it('pairs across a day boundary but not further', () => {
    const debit = transfer({ date: '2026-10-06' });
    expect(findHouseholdPairs([debit, transfer({ owner: 'bob', direction: 'credit', date: '2026-10-07' })])).toHaveLength(1);
    expect(findHouseholdPairs([debit, transfer({ owner: 'bob', direction: 'credit', date: '2026-10-08' })])).toEqual([]);
  });

  it('never pairs within one owner, or different amounts', () => {
    const debit = transfer({});
    expect(findHouseholdPairs([debit, transfer({ direction: 'credit' })])).toEqual([]);
    expect(findHouseholdPairs([debit, transfer({ owner: 'bob', direction: 'credit', amount: 40000.5 })])).toEqual([]);
  });

  it('leaves alone a debit already read as something else, or already confirmed', () => {
    const credit = transfer({ owner: 'bob', direction: 'credit' });
    expect(findHouseholdPairs([transfer({ kind: 'investment' }), credit])).toEqual([]);
    expect(findHouseholdPairs([transfer({ status: 'confirmed' }), credit])).toEqual([]);
  });

  it('prefers the nearest date when two debits could match', () => {
    const far = transfer({ date: '2026-10-06' });
    const near = transfer({ date: '2026-10-07' });
    const credit = transfer({ owner: 'bob', direction: 'credit', date: '2026-10-07' });
    expect(findHouseholdPairs([far, near, credit])).toEqual([{ debit: near, credit }]);
  });
});
