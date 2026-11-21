import { describe, it, expect } from 'vitest';
import { buildOccurrenceBuckets } from '../occurrenceBuckets';

const occ = (...dates: string[]) => dates.map((occurred_at) => ({ occurred_at }));

describe('buildOccurrenceBuckets', () => {
  it('returns nothing for no occurrences', () => {
    expect(buildOccurrenceBuckets([], 'weekly', '2026-08-23')).toEqual([]);
  });

  it('groups by calendar month', () => {
    const buckets = buildOccurrenceBuckets(
      occ('2026-06-02', '2026-06-20', '2026-07-04'),
      'monthly',
      '2026-07-31'
    );
    expect(buckets.map((b) => [b.label, b.count])).toEqual([
      ['Jun 26', 2],
      ['Jul 26', 1],
    ]);
  });

  it('groups by Monday-started week', () => {
    // 2026-08-17 is a Monday; 2026-08-23 the Sunday closing that same week.
    const buckets = buildOccurrenceBuckets(
      occ('2026-08-17', '2026-08-23'),
      'weekly',
      '2026-08-23'
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].count).toBe(2);
    expect(buckets[0].label).toBe('17 Aug');
  });

  it('splits occurrences either side of a week boundary', () => {
    // Sunday 2026-08-16 closes the previous week; Monday 2026-08-17 opens a new one.
    const buckets = buildOccurrenceBuckets(
      occ('2026-08-16', '2026-08-17'),
      'weekly',
      '2026-08-23'
    );
    expect(buckets.map((b) => b.count)).toEqual([1, 1]);
  });

  it('emits empty buckets for gaps instead of skipping them', () => {
    const buckets = buildOccurrenceBuckets(occ('2026-04-06', '2026-07-06'), 'monthly', '2026-07-31');
    expect(buckets.map((b) => [b.label, b.count])).toEqual([
      ['Apr 26', 1],
      ['May 26', 0],
      ['Jun 26', 0],
      ['Jul 26', 1],
    ]);
  });

  it('runs the range to today, so a lapsed habit shows trailing empty buckets', () => {
    const buckets = buildOccurrenceBuckets(occ('2026-05-06'), 'monthly', '2026-08-23');
    expect(buckets.map((b) => b.count)).toEqual([1, 0, 0, 0]);
    expect(buckets[buckets.length - 1].label).toBe('Aug 26');
  });

  it('keeps only the most recent maxBuckets entries', () => {
    const buckets = buildOccurrenceBuckets(occ('2024-01-15', '2026-08-10'), 'monthly', '2026-08-23');
    expect(buckets).toHaveLength(12);
    expect(buckets[buckets.length - 1].label).toBe('Aug 26');
    // The truncation drops the oldest, never the newest.
    expect(buckets[buckets.length - 1].count).toBe(1);
  });

  it('does not truncate a future-dated occurrence past today', () => {
    const buckets = buildOccurrenceBuckets(occ('2026-08-10', '2026-09-10'), 'monthly', '2026-08-23');
    expect(buckets.map((b) => b.label)).toEqual(['Aug 26', 'Sep 26']);
  });

  it('labels a weekly bucket with its full range in the tooltip', () => {
    const [bucket] = buildOccurrenceBuckets(occ('2026-08-19'), 'weekly', '2026-08-19');
    expect(bucket.tooltip).toBe('17 Aug – 23 Aug');
  });

  it('labels a monthly bucket with month and year in the tooltip', () => {
    const [bucket] = buildOccurrenceBuckets(occ('2026-08-19'), 'monthly', '2026-08-19');
    expect(bucket.tooltip).toBe('August 2026');
  });
});
