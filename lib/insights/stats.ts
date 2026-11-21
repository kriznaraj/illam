/**
 * Small statistics helpers shared by both insight engines.
 *
 * Everything here is deliberately robust rather than textbook: household data
 * routinely contains a one-off renovation month and months that were barely
 * logged at all, so plain means and plain standard deviations produce confident
 * nonsense. Medians, trimmed means and MAD do not.
 */

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Mean after dropping the single highest and single lowest value. Needs at
 * least 4 points to trim; below that it degrades to a plain mean.
 */
export function trimmedMean(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length < 4) return values.reduce((a, b) => a + b, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const kept = sorted.slice(1, -1);
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

/** Median absolute deviation — the spread measure used for forecast ranges. */
export function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/** Least-squares slope of y against its own index. Units: y per step. */
export function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Least-squares projection `steps` beyond the last point.
 * Returns the fitted value, not an extrapolated growth rate — annualising a
 * short run of percentages is what made the old portfolio projection unusable.
 */
export function projectLinear(values: number[], steps: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  const slope = linearSlope(values);
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  const intercept = meanY - slope * meanX;
  return intercept + slope * (n - 1 + steps);
}

/**
 * Herfindahl–Hirschman index over a set of shares, normalised to 0..1.
 * 1 = everything in one bucket, →0 = perfectly spread. Used instead of
 * "how many asset classes are there", which said "well diversified" for a
 * portfolio that was half a single line item.
 */
export function herfindahl(values: number[]): number {
  const positive = values.filter((v) => v > 0);
  const total = positive.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return positive.reduce((acc, v) => acc + (v / total) ** 2, 0);
}
