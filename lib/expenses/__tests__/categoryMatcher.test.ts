import { describe, it, expect } from 'vitest';
import { matchCategoryByKeyword, knownCategoryNames } from '../categoryMatcher';

// The 23 categories currently in the database (sort_order order).
const CATEGORIES = [
  'Quick bites', 'Temple & Pooja', 'Groceries & Staples', 'Mobile & Broadband',
  'Electricity', 'Cooking Gas', 'Home Maintenance', 'Fuel', 'Vehicle Maintenance',
  'Education', 'Healthcare', 'Commute & Travel', 'Dining Out', 'Recreation',
  'Grooming & Personal Care', 'Online Shopping', 'Subscriptions', 'Kids & Toys',
  'Home Improvement (One-time)', 'Gold & Jewelry (One-time)', 'Gifts (One-time)',
  'Property Tax (One-time)', 'Miscellaneous',
].map((name, i) => ({ id: `cat-${i}`, name }));

const match = (desc: string) => matchCategoryByKeyword(desc, CATEGORIES)?.categoryName ?? null;

describe('matchCategoryByKeyword', () => {
  it('every keyworded category name exists in the database category list', () => {
    // Guards against the migration-022 failure mode: categories renamed, table left stale.
    const dbNames = new Set(CATEGORIES.map((c) => c.name));
    const orphans = knownCategoryNames().filter((n) => !dbNames.has(n));
    expect(orphans).toEqual([]);
  });

  it('covers the placeholder examples shown to the user', () => {
    // The input placeholder says "e.g., Pizza for lunch, Petrol refill" — under the old
    // matcher neither of these resolved to anything.
    expect(match('Pizza for lunch')).toBe('Dining Out');
    expect(match('Petrol refill')).toBe('Fuel');
  });

  it('classifies real descriptions that were sitting in Miscellaneous', () => {
    expect(match('Pani poori ')).toBe('Quick bites');
    expect(match('Uphill donation annadhanam ')).toBe('Temple & Pooja');
    expect(match('Entry ticket ')).toBe('Recreation');
    expect(match('Bag')).toBe('Online Shopping');
  });

  it('leaves genuinely ambiguous spend unmatched instead of forcing Miscellaneous', () => {
    // Chit-fund contributions are savings, not spend — they should stay visible,
    // not be quietly absorbed by a catch-all.
    expect(match('Chittu')).toBeNull();
    expect(match('Seetu')).toBeNull();
    expect(match('Mouthly chit')).toBeNull();
    expect(match('Cash for athai ')).toBeNull();
  });

  it('prefers the longest (most specific) match', () => {
    expect(match('entry ticket for the fair')).toBe('Recreation'); // not Commute via 'ticket'
    expect(match('bus ticket')).toBe('Commute & Travel');
    expect(match('dance class fees')).toBe('Recreation');          // not Education via 'class'
    expect(match('gas cylinder booking')).toBe('Cooking Gas');
  });

  it('respects word boundaries', () => {
    expect(match('bought a gasket')).not.toBe('Cooking Gas');
    expect(match('business lunch')).not.toBe('Commute & Travel'); // 'bus' must not match
    expect(match('business lunch')).toBe('Dining Out');
  });

  it('matches a directly named category', () => {
    expect(match('Electricity bill for June')).toBe('Electricity');
    expect(match('Healthcare spend')).toBe('Healthcare');
  });

  it('returns null for empty, short, or unmatchable input', () => {
    expect(match('')).toBeNull();
    expect(match('ab')).toBeNull();
    expect(match('zzzzz qqqqq')).toBeNull();
  });

  it('never invents a category that is not in the provided list', () => {
    const tiny = [{ id: 'only', name: 'Fuel' }];
    expect(matchCategoryByKeyword('pani poori', tiny)).toBeNull();
    expect(matchCategoryByKeyword('petrol', tiny)?.categoryId).toBe('only');
  });

  it('handles a description with no categories available', () => {
    expect(matchCategoryByKeyword('petrol', [])).toBeNull();
  });
});
