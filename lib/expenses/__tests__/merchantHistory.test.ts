import { describe, expect, it } from 'vitest';
import { categoryFromHistory, normaliseMerchant, type PriorExpense } from '../merchantHistory';

const row = (over: Partial<PriorExpense> = {}): PriorExpense => ({
  date: '2026-09-01',
  merchant: 'KERALA SNACK STORE',
  description: 'KERALA SNACK STORE',
  category_id: 'cat-quick',
  category_name: 'Quick bites',
  needs_review: false,
  ...over,
});

describe('categoryFromHistory', () => {
  it('reuses the category this payee was confirmed under', () => {
    expect(categoryFromHistory('KERALA SNACK STORE', [row()])).toMatchObject({
      categoryId: 'cat-quick',
      categoryName: 'Quick bites',
      count: 1,
    });
  });

  /*
   * Every unrecognised payee is auto-filed under Miscellaneous. Reading that back as an answer
   * would make the fallback teach itself, and the payee could never climb out of it.
   */
  it('treats Miscellaneous as no answer at all', () => {
    const prior = [row({ category_id: 'cat-misc', category_name: 'Miscellaneous' })];
    expect(categoryFromHistory('KERALA SNACK STORE', prior)).toBeNull();
  });

  it('ignores expenses still awaiting review, however many', () => {
    const prior = [
      row({ needs_review: true, date: '2026-09-02' }),
      row({ needs_review: true, date: '2026-09-03' }),
    ];
    expect(categoryFromHistory('KERALA SNACK STORE', prior)).toBeNull();
  });

  // ANNAPOORNA BHAVAN can be both Dining Out and Groceries.
  it('takes what the payee is usually filed under when it drifts', () => {
    const prior = [
      row({ merchant: 'ANNAPOORNA BHAVAN', date: '2026-07-01', category_id: 'cat-dining', category_name: 'Dining Out' }),
      row({ merchant: 'ANNAPOORNA BHAVAN', date: '2026-07-10', category_id: 'cat-dining', category_name: 'Dining Out' }),
      row({ merchant: 'ANNAPOORNA BHAVAN', date: '2026-09-01', category_id: 'cat-grocery', category_name: 'Groceries & Staples' }),
    ];
    expect(categoryFromHistory('ANNAPOORNA BHAVAN', prior)).toMatchObject({ categoryId: 'cat-dining', count: 2 });
  });

  it('falls back to the most recent decision when the count ties', () => {
    const prior = [
      row({ merchant: 'ANNAPOORNA BHAVAN', date: '2026-07-01', category_id: 'cat-dining', category_name: 'Dining Out' }),
      row({ merchant: 'ANNAPOORNA BHAVAN', date: '2026-09-01', category_id: 'cat-grocery', category_name: 'Groceries & Staples' }),
    ];
    expect(categoryFromHistory('ANNAPOORNA BHAVAN', prior)).toMatchObject({ categoryId: 'cat-grocery', lastUsed: '2026-09-01' });
  });

  it('matches a payee typed in by hand before Madal existed, where it is the description', () => {
    const prior = [row({ merchant: null, description: 'Sri City Medicals', category_id: 'cat-health', category_name: 'Healthcare' })];
    expect(categoryFromHistory('SRI CITY MEDICALS', prior)).toMatchObject({ categoryId: 'cat-health' });
  });

  it('does not match a different payee', () => {
    expect(categoryFromHistory('COASTAL EXPRESS', [row()])).toBeNull();
  });

  it('refuses a payee too short to identify anyone', () => {
    // "M" is a real live merchant — an alert that captured a single letter.
    expect(categoryFromHistory('M', [row({ merchant: 'M', description: 'M' })])).toBeNull();
    expect(categoryFromHistory(null, [row()])).toBeNull();
    expect(categoryFromHistory('', [row()])).toBeNull();
  });
});

describe('normaliseMerchant', () => {
  it('ignores case, padding and trailing punctuation', () => {
    expect(normaliseMerchant('  Ramasamy  ')).toBe('RAMASAMY');
    expect(normaliseMerchant('SRI  SWEETS,')).toBe('SRI SWEETS');
    expect(normaliseMerchant(null)).toBe('');
  });
});
