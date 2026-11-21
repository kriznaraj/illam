import { describe, expect, it } from 'vitest';
import type { Tag } from '@/types';
import { AUTO_TAG_NAME, awaitsDecision, displayTags, isAutoExpense, isAutoTag } from '../autoTag';

const tag = (name: string): Tag =>
  ({ id: `tag-${name}`, name, color: '#000000', user_id: null, is_shared: true } as Tag);

const auto = tag(AUTO_TAG_NAME);

describe('isAutoTag', () => {
  it('matches regardless of case, since tags are user-creatable', () => {
    expect(isAutoTag(auto)).toBe(true);
    expect(isAutoTag(tag('Auto'))).toBe(true);
    expect(isAutoTag(tag('automatic'))).toBe(false);
  });
});

describe('isAutoExpense', () => {
  it('reads the label when it is loaded', () => {
    expect(isAutoExpense({ source: 'manual', tags: [auto] })).toBe(true);
  });

  /*
   * The load-bearing case: migration 036 seeds the tag, and until it is applied every row
   * automation ever created has no label at all. Falling back to `source` is what keeps the
   * badge honest in that window — and afterwards, for any row whose best-effort stamp failed.
   */
  it('falls back to source for a row written before the tag existed', () => {
    expect(isAutoExpense({ source: 'inbox', tags: [] })).toBe(true);
    expect(isAutoExpense({ source: 'statement' })).toBe(true);
  });

  it('is false for an expense a person typed', () => {
    expect(isAutoExpense({ source: 'manual', tags: [tag('groceries')] })).toBe(false);
    expect(isAutoExpense({ source: 'manual' })).toBe(false);
  });

  /*
   * Enriching does not change `source`: automation only fills payment_method and merchant on
   * a hand-entered row, so it must keep reading as hand-entered.
   */
  it('stays false for a hand entry automation only enriched', () => {
    expect(isAutoExpense({ source: 'manual', tags: [tag('unplanned')] })).toBe(false);
  });
});

describe('displayTags', () => {
  it('drops auto, which the row draws as its own badge', () => {
    expect(displayTags([auto, tag('groceries')]).map((t) => t.name)).toEqual(['groceries']);
  });

  it('is an empty list for no tags, so callers need no null check', () => {
    expect(displayTags(null)).toEqual([]);
    expect(displayTags(undefined)).toEqual([]);
  });
});

describe('awaitsDecision', () => {
  it('asks only about an unlooked-at row automation could not place', () => {
    expect(awaitsDecision({ needs_review: true, category: { name: 'Miscellaneous' } })).toBe(true);
    // Filed from history or keywords: nothing to decide, though nobody has touched it yet.
    expect(awaitsDecision({ needs_review: true, category: { name: 'Dining Out' } })).toBe(false);
    // Any edit clears needs_review, and that is the whole review.
    expect(awaitsDecision({ needs_review: false, category: { name: 'Miscellaneous' } })).toBe(false);
  });
});
