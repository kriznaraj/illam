import { format, startOfMonth, startOfWeek, endOfWeek, addWeeks, addMonths } from 'date-fns';
import { parseAppDate } from '@/lib/utils/dateUtils';

export type OccurrenceGrouping = 'weekly' | 'monthly';

export type OccurrenceBucket = {
  /** Bucket start as an epoch ms — stable React key and sort order. */
  key: number;
  /** Short axis label. */
  label: string;
  /** Full range/period name, shown in the tooltip. */
  tooltip: string;
  count: number;
};

/** How many buckets a chart shows. Older ones are dropped so bars stay readable on a phone. */
export const MAX_BUCKETS = 12;

/**
 * Buckets occurrences by week (Mon-start) or calendar month.
 *
 * Two deliberate choices:
 *
 * - **Empty buckets are emitted, not skipped.** A habit with a three-week gap has
 *   to read as three empty bars. The previous month-only chart dropped barren
 *   months entirely, so a stretch of nothing rendered as adjacent bars and a
 *   lapsed habit looked unbroken.
 * - **The range always runs to `today`,** not to the last occurrence, so stopping
 *   three months ago shows three empty bars rather than ending on a full one.
 */
export function buildOccurrenceBuckets(
  occurrences: { occurred_at: string }[],
  grouping: OccurrenceGrouping,
  today: string,
  maxBuckets: number = MAX_BUCKETS
): OccurrenceBucket[] {
  if (occurrences.length === 0) return [];

  const bucketStart = (d: Date) =>
    grouping === 'weekly' ? startOfWeek(d, { weekStartsOn: 1 }) : startOfMonth(d);
  const nextBucket = (d: Date) => (grouping === 'weekly' ? addWeeks(d, 1) : addMonths(d, 1));

  const counts = new Map<number, number>();
  occurrences.forEach((occ) => {
    const key = bucketStart(parseAppDate(occ.occurred_at)).getTime();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  const keys = Array.from(counts.keys());
  if (keys.length === 0) return [];
  const earliest = keys.reduce((a, b) => (b < a ? b : a));

  // A future-dated occurrence must not be truncated away by a `today` cut-off.
  const latest = keys.reduce((a, b) => (b > a ? b : a));
  const lastKey = Math.max(bucketStart(parseAppDate(today)).getTime(), latest);

  const out: OccurrenceBucket[] = [];
  let cursor = new Date(earliest);
  while (cursor.getTime() <= lastKey) {
    out.push({
      key: cursor.getTime(),
      label: grouping === 'weekly' ? format(cursor, 'd MMM') : format(cursor, 'MMM yy'),
      tooltip:
        grouping === 'weekly'
          ? `${format(cursor, 'd MMM')} – ${format(endOfWeek(cursor, { weekStartsOn: 1 }), 'd MMM')}`
          : format(cursor, 'MMMM yyyy'),
      count: counts.get(cursor.getTime()) ?? 0,
    });
    cursor = nextBucket(cursor);
  }

  return out.slice(-maxBuckets);
}
