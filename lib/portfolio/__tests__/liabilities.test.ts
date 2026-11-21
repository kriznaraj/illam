import { describe, it, expect } from 'vitest';
import {
  FALLBACK_LIABILITY_TYPE_NAMES,
  liabilityTypeNames,
  isLiabilityType,
  isLiabilityAccount,
  normalizeSnapshotAmount,
  amountOwed,
} from '../liabilities';
import type { PortfolioAccountType } from '@/types';

type TypeRow = Pick<PortfolioAccountType, 'name' | 'is_liability'>;

const withColumn: TypeRow[] = [
  { name: 'Savings Account', is_liability: false },
  { name: 'Credit Card', is_liability: true },
  { name: 'Loan', is_liability: true },
  { name: 'Mutual Funds', is_liability: false },
];

// What `select('*')` returns before migration 028 is applied by hand: the column
// simply is not there, so every row reads as undefined.
const withoutColumn: TypeRow[] = [
  { name: 'Savings Account' },
  { name: 'Credit Card' },
  { name: 'Mutual Funds' },
];

describe('liabilityTypeNames', () => {
  it('uses the is_liability flag when the column is present', () => {
    expect(liabilityTypeNames(withColumn)).toEqual(new Set(['Credit Card', 'Loan']));
  });

  it('falls back to the known names when the column has not been added yet', () => {
    // Reading "no row is flagged" as "nothing is a liability" would silently
    // reintroduce the sign bug for the whole window before 028 is applied.
    expect(liabilityTypeNames(withoutColumn)).toEqual(new Set(FALLBACK_LIABILITY_TYPE_NAMES));
  });

  it('falls back when the types could not be loaded at all', () => {
    expect(liabilityTypeNames(null)).toEqual(new Set(FALLBACK_LIABILITY_TYPE_NAMES));
    expect(liabilityTypeNames([])).toEqual(new Set(FALLBACK_LIABILITY_TYPE_NAMES));
  });

  it('honours an explicit empty set once the column exists', () => {
    // The column is present and nothing is flagged — that is a real answer, not a
    // missing column, so it must NOT fall back.
    const noneFlagged: TypeRow[] = [
      { name: 'Savings Account', is_liability: false },
      { name: 'Credit Card', is_liability: false },
    ];
    expect(liabilityTypeNames(noneFlagged)).toEqual(new Set());
  });
});

describe('isLiabilityType / isLiabilityAccount', () => {
  const types = liabilityTypeNames(withColumn);

  it('matches liability type names', () => {
    expect(isLiabilityType('Credit Card', types)).toBe(true);
    expect(isLiabilityType('Loan', types)).toBe(true);
    expect(isLiabilityType('Mutual Funds', types)).toBe(false);
  });

  it('treats a missing type as not a liability', () => {
    expect(isLiabilityType(null, types)).toBe(false);
    expect(isLiabilityType(undefined, types)).toBe(false);
  });

  it('reads the type off an account', () => {
    expect(isLiabilityAccount({ type: 'Credit Card' } as never, types)).toBe(true);
    expect(isLiabilityAccount({ type: 'Gold' } as never, types)).toBe(false);
    expect(isLiabilityAccount(null, types)).toBe(false);
  });
});

describe('normalizeSnapshotAmount', () => {
  it('forces a liability negative whatever sign it arrives with', () => {
    // The statement sync passes credit_card_statements.statement_amount, which is
    // always positive — the exact path that broke net worth from 2026-01.
    expect(normalizeSnapshotAmount(61070, true)).toBe(-61070);
    expect(normalizeSnapshotAmount(-61070, true)).toBe(-61070);
    expect(normalizeSnapshotAmount(5153.43, true)).toBe(-5153.43);
  });

  it('leaves assets exactly as supplied, including negatives', () => {
    expect(normalizeSnapshotAmount(4457169, false)).toBe(4457169);
    // An asset can legitimately be negative (an overdrawn account); do not touch it.
    expect(normalizeSnapshotAmount(-1200, false)).toBe(-1200);
  });

  it('never produces -0, which serialises into JSON and reads as a bug', () => {
    expect(Object.is(normalizeSnapshotAmount(0, true), 0)).toBe(true);
    expect(Object.is(normalizeSnapshotAmount(-0, true), 0)).toBe(true);
  });
});

describe('amountOwed', () => {
  it('reports a stored liability as a positive figure for display', () => {
    expect(amountOwed(-61070)).toBe(61070);
    expect(amountOwed(0)).toBe(0);
  });
});

describe('net worth arithmetic', () => {
  it('subtracts debt once stored negative, instead of adding it', () => {
    // The live 2026-09-01 card balances, which were all stored positive.
    const cards = [61070, 0, 2601, 5153.43, 6968, 2530, 5116];
    const assets = 10_000_000;

    const broken = assets + cards.reduce((s, c) => s + c, 0);
    const fixed = assets + cards.reduce((s, c) => s + normalizeSnapshotAmount(c, true), 0);

    // The error is worth twice the balance, not once.
    expect(broken - fixed).toBeCloseTo(2 * 83438.43, 2);
    expect(fixed).toBeCloseTo(assets - 83438.43, 2);
  });
});
