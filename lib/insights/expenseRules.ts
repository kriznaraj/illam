/**
 * Selavu (expenses) insight rules.
 *
 * Pure functions over a prepared dataset — no Supabase, no dates from the wall
 * clock beyond what the caller passes in. `InsightsService` fetches and calls;
 * everything decidable lives here so it can be tested directly.
 *
 * Two ideas drive the whole file:
 *
 * 1. **Materiality.** The previous engine fired on percentage alone, so a month
 *    dominated by a large one-time renovation could be reported as "Egg Spike —
 *    ₹495, 87% above average" while the renovation itself went unmentioned.
 *    Every rule here must clear an absolute rupee floor as well as a share of
 *    the month.
 *
 * 2. **Recurring vs one-time.** `categories.group_name` is the planning
 *    dimension the whole app is built on and no insight had ever read it. A
 *    renovation is not overspending, and it must not be allowed to set the
 *    baseline that later months are judged against.
 */

import { differenceInCalendarDays, format, getDaysInMonth, parseISO } from 'date-fns';
import type { Insight } from '@/types';
import { inr, joinList, plural } from './format';
import { linearSlope, median, medianAbsoluteDeviation, trimmedMean } from './stats';

// --- thresholds -------------------------------------------------------------
// Named so the reason for each is greppable. The egg/milk case below is the
// kind of output the old engine produced.

/** A category move under this many rupees is not worth a card. Kills "Egg Spike — ₹495". */
export const MIN_DELTA_RUPEES = 2_000;
/** ...and it must also be at least this share of the month's recurring spend. */
export const MIN_DELTA_SHARE = 0.01;
/** A category that barely appears this month cannot be a "spike" regardless of percentage. */
export const MIN_CATEGORY_RUPEES = 1_000;
/** Percentage move required on top of the rupee floors. */
export const MIN_CHANGE_PERCENT = 40;
/** A category needs this much history before "your N-month average" means anything. */
export const MIN_CATEGORY_HISTORY_MONTHS = 3;
/** Month-level verdicts ("you overspent") need a real baseline behind them. */
export const MIN_BASELINE_MONTHS = 6;
/** At most this many anomaly cards, ranked by rupee delta. The old engine could emit six in a month. */
export const MAX_ANOMALIES = 4;
/** A month logging fewer than this share of the median transaction count is not trustworthy. */
export const LOW_CONFIDENCE_COUNT_RATIO = 0.4;
/** Weekend/weekday split needs a real rupee gap, not just a ratio. */
export const MIN_WEEKEND_GAP_RUPEES = 5_000;
/** Hard cap on cards per month. Beyond this nobody reads them. */
export const MAX_INSIGHTS = 10;

export const UNPLANNED_SHARE_THRESHOLD = 0.10;
export const WANT_SHARE_THRESHOLD = 0.35;
export const ONE_TIME_SHARE_THRESHOLD = 0.20;
export const CONCENTRATION_SHARE_THRESHOLD = 0.30;
export const CATCH_ALL_SHARE_THRESHOLD = 0.08;

/** Planning groups that represent ongoing household running costs. */
export const RECURRING_GROUPS = ['Need', 'Want', 'Unplanned'];
export const ONE_TIME_GROUP = 'One-time';

/**
 * Categories that are catch-alls in practice. Spend piling up here means the
 * data is decaying, not that a real category grew.
 */
const CATCH_ALL_NAMES = ['miscellaneous', 'misc', 'other', 'others', 'uncategorised', 'uncategorized', 'unknown'];

export function isCatchAllCategory(name: string): boolean {
  return CATCH_ALL_NAMES.includes(name.trim().toLowerCase());
}

// --- shapes -----------------------------------------------------------------

export interface ExpenseRow {
  id: string;
  /** yyyy-MM-dd */
  date: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  /** 'Need' | 'Want' | 'One-time' | 'Unplanned', or 'Unknown' when unset. */
  groupName: string;
  budget: number | null;
  description: string;
}

export interface CategoryBucket {
  categoryId: string;
  name: string;
  groupName: string;
  total: number;
  count: number;
}

export interface MonthBucket {
  /** yyyy-MM */
  key: string;
  /** 'April 2026' */
  label: string;
  total: number;
  /** Need + Want + Unplanned + anything ungrouped. The number baselines are built on. */
  recurring: number;
  /** One-time. Reported, never used as a baseline. */
  oneTime: number;
  byGroup: Record<string, number>;
  byCategory: Record<string, CategoryBucket>;
  count: number;
  /** Too few transactions logged to trust — excluded from every average. */
  lowConfidence: boolean;
}

export interface PreparedExpenseData {
  analysisMonthKey: string;
  analysisLabel: string;
  month: MonthBucket;
  /** Ascending, excludes the analysis month. */
  history: MonthBucket[];
  /** `history` minus low-confidence months. What every baseline uses. */
  cleanHistory: MonthBucket[];
  /** Months dropped for being under-logged. */
  excludedMonths: MonthBucket[];
  /** Same calendar month one year earlier, if present in the window. */
  sameMonthLastYear: MonthBucket | null;
  /** True when the analysis month is still in progress. */
  isOpenMonth: boolean;
  /** Elapsed days in an open month, from the app-timezone today. */
  daysElapsed: number;
  daysInMonth: number;
  /**
   * Running-cost rupees by day-of-week index (0 = Sunday) for the analysis month.
   * One-time spend is excluded: a single weekend jewellery purchase otherwise reports
   * as "weekends cost 5x more".
   */
  spendByDayOfWeek: number[];
  /** categoryId → monthly budget, from `categories.budget`. Empty when nothing is budgeted. */
  budgets: Map<string, number>;
}

// --- preparation ------------------------------------------------------------

function isRecurringGroup(group: string): boolean {
  return group !== ONE_TIME_GROUP;
}

/** An in-progress month is naturally light on transactions; that is not a data fault. */
function isOpenMonthKey(monthKey: string, todayAppDate: string): boolean {
  return todayAppDate.slice(0, 7) === monthKey;
}

function emptyMonth(key: string): MonthBucket {
  return {
    key,
    label: format(parseISO(`${key}-01`), 'MMMM yyyy'),
    total: 0,
    recurring: 0,
    oneTime: 0,
    byGroup: {},
    byCategory: {},
    count: 0,
    lowConfidence: false,
  };
}

function addToMonth(bucket: MonthBucket, row: ExpenseRow): void {
  bucket.total += row.amount;
  bucket.count += 1;
  bucket.byGroup[row.groupName] = (bucket.byGroup[row.groupName] ?? 0) + row.amount;
  if (isRecurringGroup(row.groupName)) bucket.recurring += row.amount;
  else bucket.oneTime += row.amount;

  const cat = bucket.byCategory[row.categoryId] ?? {
    categoryId: row.categoryId,
    name: row.categoryName,
    groupName: row.groupName,
    total: 0,
    count: 0,
  };
  cat.total += row.amount;
  cat.count += 1;
  bucket.byCategory[row.categoryId] = cat;
}

/**
 * Bucket rows into months and mark the untrustworthy ones.
 *
 * `todayAppDate` must come from `getTodayAppDate()` — never `new Date()`. The
 * open-month run rate divides by elapsed days and would be wrong by a day for
 * roughly five hours of every IST day otherwise.
 */
export function prepareExpenseData(params: {
  rows: ExpenseRow[];
  analysisMonthKey: string;
  todayAppDate: string;
}): PreparedExpenseData {
  const { rows, analysisMonthKey, todayAppDate } = params;

  const buckets = new Map<string, MonthBucket>();
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = emptyMonth(key);
      buckets.set(key, bucket);
    }
    addToMonth(bucket, row);
  }

  const month = buckets.get(analysisMonthKey) ?? emptyMonth(analysisMonthKey);
  const history = Array.from(buckets.values())
    .filter((b) => b.key < analysisMonthKey)
    .sort((a, b) => a.key.localeCompare(b.key));

  // A month is judged against its peers, not an absolute count: this household
  // logs ~90 transactions in a normal month but only 9 in Sep 2025.
  const medianCount = median(history.concat(month).map((b) => b.count));
  const countFloor = medianCount * LOW_CONFIDENCE_COUNT_RATIO;
  for (const bucket of history) {
    bucket.lowConfidence = medianCount > 0 && bucket.count < countFloor;
  }
  // The analysis month gets judged too. A month with 9 logged transactions did not
  // achieve "excellent spending control"; it was not written down. Rules that compare
  // against a baseline are suppressed for such a month — see TRUSTED_MONTH_RULES.
  month.lowConfidence = medianCount > 0 && month.count < countFloor && !isOpenMonthKey(analysisMonthKey, todayAppDate);

  const cleanHistory = history.filter((b) => !b.lowConfidence);
  const excludedMonths = history.filter((b) => b.lowConfidence);

  const lastYearKey = format(
    new Date(Number(analysisMonthKey.slice(0, 4)) - 1, Number(analysisMonthKey.slice(5, 7)) - 1, 1),
    'yyyy-MM'
  );
  const sameMonthLastYear = buckets.get(lastYearKey) ?? null;

  const monthStart = parseISO(`${analysisMonthKey}-01`);
  const daysInMonth = getDaysInMonth(monthStart);
  const todayKey = todayAppDate.slice(0, 7);
  const isOpenMonth = todayKey === analysisMonthKey;
  const daysElapsed = isOpenMonth
    ? Math.min(daysInMonth, differenceInCalendarDays(parseISO(todayAppDate), monthStart) + 1)
    : daysInMonth;

  const spendByDayOfWeek = [0, 0, 0, 0, 0, 0, 0];
  const budgets = new Map<string, number>();
  for (const row of rows) {
    if (row.budget != null && row.budget > 0) budgets.set(row.categoryId, row.budget);
    if (row.date.slice(0, 7) !== analysisMonthKey) continue;
    if (!isRecurringGroup(row.groupName)) continue;
    spendByDayOfWeek[parseISO(row.date).getDay()] += row.amount;
  }

  return {
    analysisMonthKey,
    analysisLabel: month.label,
    month,
    history,
    cleanHistory,
    excludedMonths,
    sameMonthLastYear,
    isOpenMonth,
    daysElapsed: Math.max(1, daysElapsed),
    daysInMonth,
    spendByDayOfWeek,
    budgets,
  };
}

// --- shared baseline ---

/** How many recent clean months define "normal". */
export const BASELINE_WINDOW = 6;

/**
 * The one baseline figure the whole page quotes.
 *
 * Every rule that needs "what a normal month costs" calls this, so the run-rate card,
 * the month verdict and the forecast cannot quote three different numbers for the same
 * idea. Trimmed mean over the most recent clean months: recent enough to reflect how
 * the household actually lives now, trimmed so one renovation month cannot set it.
 * Returns 0 when there is not enough clean history to claim anything.
 */
export function baselineRecurring(months: MonthBucket[]): number {
  const clean = months.filter((m) => !m.lowConfidence).map((m) => m.recurring);
  if (clean.length < 3) return 0;
  return trimmedMean(clean.slice(-BASELINE_WINDOW));
}

// --- shared gate ------------------------------------------------------------

/** All three floors must clear. This is the single reason the noise disappeared. */
export function isMaterial(deltaRupees: number, monthRecurring: number): boolean {
  const abs = Math.abs(deltaRupees);
  if (abs < MIN_DELTA_RUPEES) return false;
  if (monthRecurring > 0 && abs < monthRecurring * MIN_DELTA_SHARE) return false;
  return true;
}

// --- rules ------------------------------------------------------------------

type Rule = (data: PreparedExpenseData) => Insight[];

/**
 * Says out loud when the comparisons below are standing on sand. Emitted first
 * so the user reads it before any "vs your N-month average" claim.
 */
const dataQualityRule: Rule = (d) => {
  if (d.excludedMonths.length < 2) return [];
  const names = d.excludedMonths.map((m) => format(parseISO(`${m.key}-01`), 'MMM yyyy'));
  const counts = d.excludedMonths.map((m) => m.count);
  return [
    {
      id: 'data-quality-history',
      type: 'data_quality',
      severity: 'warning',
      icon: '🩺',
      title: 'Baseline Is Missing Data',
      description:
        `${joinList(names)} logged only ${counts.join(', ')} transactions each — far below your ` +
        `typical month — so they have been excluded from every average on this page. ` +
        `Comparisons for ${d.analysisLabel} are based on ${plural(d.cleanHistory.length, 'complete month')}.`,
      action: 'Backfill those months if you still have the receipts; until then treat trend percentages as provisional.',
      // Deliberately tiny: this is context for the other cards, so it sits at the
      // bottom of the warning band rather than above what actually happened.
      weight: 1,
    },
  ];
};

/**
 * The analysis month itself is under-logged. Emitted instead of — not alongside —
 * every baseline comparison, because "you spent 62% less than usual" on a month with
 * 9 recorded transactions is a claim about the record, not about the spending.
 */
const thinMonthRule: Rule = (d) => {
  if (!d.month.lowConfidence) return [];
  const typical = median(d.cleanHistory.map((m) => m.count));
  return [
    {
      id: 'data-quality-month',
      type: 'data_quality',
      severity: 'warning',
      icon: '🕳️',
      title: 'This Month Looks Under-Logged',
      description:
        `${d.analysisLabel} has only ${plural(d.month.count, 'transaction')} recorded, ` +
        `against a typical ${Math.round(typical)}. The ${inr(d.month.total)} total is almost certainly ` +
        `short, so baseline comparisons and achievements are suppressed for this month.`,
      value: d.month.total,
      action: 'Add the missing entries before reading anything else into this month.',
      weight: Number.MAX_SAFE_INTEGER,
    },
  ];
};

/** One-time spend is reported as project spend, never as overspending. */
const oneTimeLoadRule: Rule = (d) => {
  const { oneTime, total } = d.month;
  if (oneTime <= 0 || total <= 0) return [];
  const share = oneTime / total;
  if (share < ONE_TIME_SHARE_THRESHOLD || oneTime < MIN_DELTA_RUPEES) return [];

  const trailing = d.history.reduce((s, m) => s + m.oneTime, 0) + oneTime;
  const topCats = Object.values(d.month.byCategory)
    .filter((c) => c.groupName === ONE_TIME_GROUP)
    .sort((a, b) => b.total - a.total)
    .slice(0, 2)
    .map((c) => `${c.name} ${inr(c.total)}`);

  return [
    {
      id: 'one-time-load',
      type: 'trend',
      severity: share > 0.5 ? 'warning' : 'info',
      icon: '🏗️',
      title: 'One-Time Spend Dominated the Month',
      description:
        `${inr(oneTime)} of ${d.analysisLabel}'s ${inr(total)} was one-time spend (${(share * 100).toFixed(0)}%)` +
        `${topCats.length ? ` — mostly ${joinList(topCats)}` : ''}. ` +
        `Running costs were ${inr(d.month.recurring)}. Across the last ${plural(d.history.length + 1, 'month')} ` +
        `one-time spend totals ${inr(trailing)}.`,
      value: oneTime,
      change: share * 100,
      action: 'This is project spend, not overspending — judge the month on the running-cost figure instead.',
      weight: oneTime,
    },
  ];
};

/** The month-level verdict, on recurring spend only, against a trimmed median. */
const recurringBaselineRule: Rule = (d) => {
  if (d.cleanHistory.length < MIN_BASELINE_MONTHS) return [];
  const baseline = baselineRecurring(d.cleanHistory);
  if (baseline <= 0) return [];

  const actual = d.month.recurring;
  const delta = actual - baseline;
  if (!isMaterial(delta, baseline)) return [];

  const changePercent = (delta / baseline) * 100;
  const up = delta > 0;

  return [
    {
      id: up ? 'high-spending' : 'low-spending',
      type: 'achievement',
      severity: up ? 'warning' : 'success',
      icon: up ? '📊' : '🌟',
      title: up ? 'Running Costs Ran Hot' : 'Running Costs Held Down',
      description:
        `${d.analysisLabel} running costs were ${inr(actual)}, ${Math.abs(changePercent).toFixed(0)}% ` +
        `${up ? 'above' : 'below'} your recent baseline of ${inr(baseline)} ` +
        `(${up ? '+' : ''}${inr(delta)}). One-time spend is excluded from both figures.`,
      value: actual,
      change: changePercent,
      action: up ? 'Check the category movers below before deciding whether this was a one-off.' : null,
      weight: Math.abs(delta),
    },
  ];
};

/** Category movers, gated on rupees and capped so the page stays readable. */
const categoryAnomalyRule: Rule = (d) => {
  if (d.cleanHistory.length < 2) return [];

  const historyByCategory = new Map<string, { name: string; total: number; months: Set<string> }>();
  for (const m of d.cleanHistory) {
    for (const cat of Object.values(m.byCategory)) {
      const entry = historyByCategory.get(cat.categoryId) ?? { name: cat.name, total: 0, months: new Set<string>() };
      entry.total += cat.total;
      entry.months.add(m.key);
      historyByCategory.set(cat.categoryId, entry);
    }
  }

  const candidates: Array<Insight & { weight: number }> = [];

  for (const cat of Object.values(d.month.byCategory)) {
    // Owned by catchAllRule. Otherwise Miscellaneous gets three cards in one month:
    // a spike, a concentration note and the rot warning, all saying the same thing.
    if (isCatchAllCategory(cat.name)) continue;
    // Owned by oneTimeLoadRule, which already names the largest one-time categories.
    // A renovation is not a "spike" against its own average — it is a project.
    if (cat.groupName === ONE_TIME_GROUP) continue;
    const hist = historyByCategory.get(cat.categoryId);
    if (!hist) continue;
    const monthsSeen = hist.months.size;
    if (monthsSeen < MIN_CATEGORY_HISTORY_MONTHS) continue;
    if (cat.total < MIN_CATEGORY_RUPEES) continue;

    const avg = hist.total / monthsSeen;
    if (avg <= 0) continue;
    const delta = cat.total - avg;
    const changePercent = (delta / avg) * 100;

    if (Math.abs(changePercent) < MIN_CHANGE_PERCENT) continue;
    if (!isMaterial(delta, d.month.recurring)) continue;

    const up = delta > 0;
    candidates.push({
      id: `anomaly-${cat.categoryId}`,
      type: 'anomaly',
      severity: up ? 'warning' : 'success',
      icon: up ? '⚠️' : '✅',
      title: `${cat.name} ${up ? 'Spike' : 'Drop'}`,
      description:
        `${cat.name} was ${inr(cat.total)} in ${d.analysisLabel}, ${Math.abs(changePercent).toFixed(0)}% ` +
        `${up ? 'above' : 'below'} its ${plural(monthsSeen, 'month')} average of ${inr(avg)} ` +
        `(${up ? '+' : ''}${inr(delta)} across ${plural(cat.count, 'transaction')}).`,
      value: cat.total,
      change: changePercent,
      action: up ? `Confirm the extra ${inr(Math.abs(delta))} was intentional.` : null,
      weight: Math.abs(delta),
    });
  }

  return candidates.sort((a, b) => b.weight - a.weight).slice(0, MAX_ANOMALIES);
};

/** Unplanned is a planning failure signal and had no rule at all. */
const unplannedShareRule: Rule = (d) => {
  const unplanned = d.month.byGroup['Unplanned'] ?? 0;
  const recurring = d.month.recurring;
  if (recurring <= 0 || unplanned < MIN_DELTA_RUPEES) return [];
  const share = unplanned / recurring;
  if (share < UNPLANNED_SHARE_THRESHOLD) return [];

  const histShares = d.cleanHistory
    .filter((m) => m.recurring > 0)
    .map((m) => (m.byGroup['Unplanned'] ?? 0) / m.recurring);
  const typical = histShares.length ? median(histShares) * 100 : 0;

  return [
    {
      id: 'unplanned-share',
      type: 'pattern',
      severity: share > 0.25 ? 'danger' : 'warning',
      icon: '🎲',
      title: 'Unplanned Spending Is High',
      description:
        `${inr(unplanned)} of ${d.analysisLabel}'s ${inr(recurring)} running costs was Unplanned ` +
        `(${(share * 100).toFixed(0)}%)${histShares.length ? `, against a typical ${typical.toFixed(0)}%` : ''}. ` +
        `That is money that left without a decision behind it.`,
      value: unplanned,
      change: share * 100,
      action: 'Move the recurring items out of Unplanned into a real category and budget them.',
      weight: unplanned,
    },
  ];
};

/** Want outrunning Need is the discretionary-drift signal. */
const wantShareRule: Rule = (d) => {
  const want = d.month.byGroup['Want'] ?? 0;
  const need = d.month.byGroup['Need'] ?? 0;
  const recurring = d.month.recurring;
  if (recurring <= 0 || want < MIN_DELTA_RUPEES) return [];
  const share = want / recurring;
  if (share < WANT_SHARE_THRESHOLD) return [];

  const topWants = Object.values(d.month.byCategory)
    .filter((c) => c.groupName === 'Want')
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
    .map((c) => `${c.name} ${inr(c.total)}`);

  return [
    {
      id: 'want-share',
      type: 'pattern',
      severity: want > need ? 'warning' : 'info',
      icon: '🛍️',
      title: want > need ? 'Wants Outspent Needs' : 'Discretionary Share Is High',
      description:
        `Want categories took ${inr(want)} of ${inr(recurring)} running costs in ${d.analysisLabel} ` +
        `(${(share * 100).toFixed(0)}%), against ${inr(need)} on Needs. ` +
        `${topWants.length ? `Largest: ${joinList(topWants)}.` : ''}`,
      value: want,
      change: share * 100,
      action: 'Pick the one Want line to cap next month rather than trimming everything.',
      weight: want,
    },
  ];
};

/** Need is supposed to be the stable floor. When it trends up, that is structural. */
const needCreepRule: Rule = (d) => {
  const series = [...d.cleanHistory.slice(-5), d.month].map((m) => m.byGroup['Need'] ?? 0);
  if (series.length < 4) return [];
  const slope = linearSlope(series);
  const monthlyDrift = slope;
  if (monthlyDrift <= 0) return [];
  const projectedAnnual = monthlyDrift * 12;
  if (!isMaterial(projectedAnnual, d.month.recurring * 12)) return [];
  if (monthlyDrift < MIN_DELTA_RUPEES / 4) return [];

  return [
    {
      id: 'need-creep',
      type: 'trend',
      severity: 'warning',
      icon: '📈',
      title: 'Essential Costs Are Creeping Up',
      description:
        `Need spending has risen about ${inr(monthlyDrift)} per month across the last ` +
        `${plural(series.length, 'month')} (${inr(series[0])} → ${inr(series[series.length - 1])}). ` +
        `Held at this rate that is ${inr(projectedAnnual)} more over a year.`,
      value: series[series.length - 1],
      change: series[0] > 0 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : null,
      action: 'Needs are the hardest costs to cut later — find the driver now, not at renewal time.',
      weight: projectedAnnual,
    },
  ];
};

/** Spend piling into a catch-all category means the data is rotting. */
const catchAllRule: Rule = (d) => {
  const catchAll = Object.values(d.month.byCategory).filter((c) => isCatchAllCategory(c.name));
  if (catchAll.length === 0) return [];
  const total = catchAll.reduce((s, c) => s + c.total, 0);
  const count = catchAll.reduce((s, c) => s + c.count, 0);
  if (total < MIN_DELTA_RUPEES) return [];
  if (d.month.recurring > 0 && total / d.month.recurring < CATCH_ALL_SHARE_THRESHOLD) return [];

  // In this database `Miscellaneous` is the only category in the Unplanned group, so
  // when unplannedShareRule has already fired these are literally the same rupees told
  // twice. Defer to that card, which carries the stronger severity. If the household
  // ever adds a second Unplanned category the two stop overlapping and both appear.
  const unplanned = d.month.byGroup['Unplanned'] ?? 0;
  const unplannedFires =
    d.month.recurring > 0 &&
    unplanned >= MIN_DELTA_RUPEES &&
    unplanned / d.month.recurring >= UNPLANNED_SHARE_THRESHOLD;
  if (unplannedFires && unplanned > 0 && total / unplanned >= 0.8) return [];

  const trailing = d.history.reduce(
    (s, m) =>
      s +
      Object.values(m.byCategory)
        .filter((c) => isCatchAllCategory(c.name))
        .reduce((t, c) => t + c.total, 0),
    total
  );

  return [
    {
      id: 'catch-all-rot',
      type: 'data_quality',
      severity: 'warning',
      icon: '🗂️',
      title: 'Too Much Landing in Miscellaneous',
      description:
        `${inr(total)} across ${plural(count, 'transaction')} went to ${joinList(catchAll.map((c) => c.name))} ` +
        `in ${d.analysisLabel} — ${((total / Math.max(1, d.month.recurring)) * 100).toFixed(0)}% of running costs. ` +
        `Over the whole window that is ${inr(trailing)} you cannot analyse.`,
      value: total,
      action: 'Run `npx tsx scripts/recategorize-misc.ts` to see suggested categories (dry run by default).',
      weight: total,
    },
  ];
};

/** Concentration in a single category — useful context, low severity. */
const concentrationRule: Rule = (d) => {
  const recurring = d.month.recurring;
  if (recurring <= 0) return [];
  const top = Object.values(d.month.byCategory)
    .filter((c) => c.groupName !== ONE_TIME_GROUP && !isCatchAllCategory(c.name))
    .sort((a, b) => b.total - a.total)[0];
  if (!top) return [];
  const share = top.total / recurring;
  if (share < CONCENTRATION_SHARE_THRESHOLD || top.total < MIN_DELTA_RUPEES) return [];

  return [
    {
      id: 'category-concentration',
      type: 'pattern',
      severity: 'info',
      icon: '🎯',
      title: `${top.name} Led the Month`,
      description:
        `${top.name} was ${inr(top.total)} — ${(share * 100).toFixed(0)}% of ${d.analysisLabel}'s ` +
        `${inr(recurring)} running costs, across ${plural(top.count, 'transaction')}.`,
      value: top.total,
      change: share * 100,
      weight: top.total,
    },
  ];
};

/**
 * Weekend split by *rupee share*. The old version compared per-transaction
 * averages, which just reported wherever the single largest purchase landed.
 */
const weekendRule: Rule = (d) => {
  const weekend = d.spendByDayOfWeek[0] + d.spendByDayOfWeek[6];
  const weekday = d.spendByDayOfWeek.slice(1, 6).reduce((a, b) => a + b, 0);
  if (weekday <= 0 || weekend <= 0) return [];

  // Normalise: ~2 weekend days against ~5 weekdays.
  const weekendPerDay = weekend / 2;
  const weekdayPerDay = weekday / 5;
  const gap = weekendPerDay - weekdayPerDay;
  if (gap < MIN_WEEKEND_GAP_RUPEES) return [];
  if (weekendPerDay < weekdayPerDay * 1.3) return [];

  return [
    {
      id: 'weekend-spending',
      type: 'pattern',
      severity: 'info',
      icon: '📅',
      title: 'Weekends Cost More',
      description:
        `${d.analysisLabel} weekends averaged ${inr(weekendPerDay)} per day against ${inr(weekdayPerDay)} ` +
        `on weekdays — ${inr(gap)} more per weekend day, ${inr(weekend)} in total.`,
      value: weekend,
      change: (weekendPerDay / weekdayPerDay - 1) * 100,
      weight: gap * 8,
    },
  ];
};

/** Year-over-year, now that the fetch window actually reaches back far enough. */
const yearOverYearRule: Rule = (d) => {
  const lastYear = d.sameMonthLastYear;
  if (!lastYear || lastYear.lowConfidence || lastYear.recurring <= 0) return [];
  const delta = d.month.recurring - lastYear.recurring;
  if (!isMaterial(delta, lastYear.recurring)) return [];
  const changePercent = (delta / lastYear.recurring) * 100;

  return [
    {
      id: 'yoy-trend',
      type: 'trend',
      // Only a large swing earns a warning. Against a sparsely-logged prior year this
      // rule fired at warning severity in every single month, which is not information.
      severity: Math.abs(changePercent) > 50 ? 'warning' : 'info',
      icon: changePercent > 0 ? '📈' : '📉',
      title: 'Year-over-Year',
      description:
        `${d.analysisLabel} running costs (${inr(d.month.recurring)}) were ` +
        `${Math.abs(changePercent).toFixed(0)}% ${changePercent > 0 ? 'higher' : 'lower'} than ` +
        `${lastYear.label} (${inr(lastYear.recurring)}).`,
      value: d.month.recurring,
      change: changePercent,
      // Discounted: a same-month-last-year comparison is weaker evidence than a
      // move against the trailing baseline, which uses far more data.
      weight: Math.abs(delta) * 0.3,
    },
  ];
};

// --- projections ------------------------------------------------------------

/** Open month only: where this month lands if the current pace holds. */
const runRateRule: Rule = (d) => {
  if (!d.isOpenMonth) return [];
  if (d.daysElapsed < 5 || d.daysElapsed >= d.daysInMonth) return [];
  const perDay = d.month.recurring / d.daysElapsed;
  const projected = perDay * d.daysInMonth;
  const baseline = baselineRecurring(d.cleanHistory);
  const delta = baseline > 0 ? projected - baseline : 0;

  return [
    {
      id: 'run-rate-projection',
      type: 'prediction',
      severity: baseline > 0 && delta > 0 && isMaterial(delta, baseline) ? 'warning' : 'info',
      icon: '⏱️',
      title: 'Month-End Run Rate',
      description:
        `${inr(d.month.recurring)} of running costs in ${d.daysElapsed} days — ${inr(perDay)} a day. ` +
        `At this pace ${d.analysisLabel} closes near ${inr(projected)}` +
        `${baseline > 0 ? `, ${delta >= 0 ? inr(delta) + ' above' : inr(-delta) + ' below'} your ${inr(baseline)} baseline` : ''}.`,
      value: projected,
      change: baseline > 0 ? (delta / baseline) * 100 : null,
      action: baseline > 0 && delta > 0 ? `Trimming ${inr(delta / Math.max(1, d.daysInMonth - d.daysElapsed))} a day for the rest of the month closes the gap.` : null,
      weight: Math.abs(delta) || projected,
    },
  ];
};

/** Next month as a range, because a point estimate on 6 noisy months is a lie. */
const nextMonthForecastRule: Rule = (d) => {
  const pool = [...d.cleanHistory, ...(d.isOpenMonth || d.month.lowConfidence ? [] : [d.month])];
  const recent = pool.slice(-BASELINE_WINDOW).map((m) => m.recurring);
  if (recent.length < 4) return [];
  const centre = baselineRecurring(pool);
  const spread = medianAbsoluteDeviation(recent);
  if (centre <= 0) return [];

  return [
    {
      id: 'next-month-forecast',
      type: 'prediction',
      severity: 'info',
      icon: '🔮',
      title: 'Next Month, Expected',
      description:
        `On the last ${plural(recent.length, 'month')} of running costs, expect roughly ${inr(centre)} ` +
        `next month — typically between ${inr(Math.max(0, centre - spread))} and ${inr(centre + spread)}. ` +
        `One-time projects are not included.`,
      value: centre,
      action: `Set aside ${inr(centre + spread)} to cover a normal month without dipping into savings.`,
      weight: centre,
    },
  ];
};

/** Financial-year view, April start — matching the portfolio dashboard's FY logic. */
const annualForecastRule: Rule = (d) => {
  const year = Number(d.analysisMonthKey.slice(0, 4));
  const monthNo = Number(d.analysisMonthKey.slice(5, 7));
  const fyStartYear = monthNo >= 4 ? year : year - 1;
  const fyStartKey = `${fyStartYear}-04`;

  const fyMonths = [...d.history, d.month].filter((m) => m.key >= fyStartKey);
  if (fyMonths.length < 3) return [];

  const fyRecurring = fyMonths.reduce((s, m) => s + m.recurring, 0);
  const fyOneTime = fyMonths.reduce((s, m) => s + m.oneTime, 0);
  const monthsRemaining = 12 - fyMonths.length;
  if (monthsRemaining <= 0) return [];

  const cleanFy = fyMonths.filter((m) => !m.lowConfidence).map((m) => m.recurring);
  const perMonth = trimmedMean(cleanFy.length >= 3 ? cleanFy : fyMonths.map((m) => m.recurring));
  const projected = fyRecurring + perMonth * monthsRemaining;

  return [
    {
      id: 'annual-forecast',
      type: 'prediction',
      severity: 'info',
      icon: '🗓️',
      title: `FY${String(fyStartYear + 1).slice(2)} Running-Cost Forecast`,
      description:
        `${plural(fyMonths.length, 'month')} into FY${fyStartYear}–${String(fyStartYear + 1).slice(2)} you have spent ` +
        `${inr(fyRecurring)} on running costs at ${inr(perMonth)} a month. ` +
        `The remaining ${plural(monthsRemaining, 'month')} project to a full-year ${inr(projected)}. ` +
        `One-time spend so far is a further ${inr(fyOneTime)}.`,
      value: projected,
      weight: projected,
    },
  ];
};

/**
 * `categories.budget` has existed in the schema all along and no insight had
 * ever read it. Projects an open month forward; reports the actual on a closed one.
 */
const budgetBreachRule: Rule = (d) => {
  const scale = d.isOpenMonth ? d.daysInMonth / d.daysElapsed : 1;
  const breaches: Array<{ name: string; budget: number; projected: number }> = [];

  for (const cat of Object.values(d.month.byCategory)) {
    const budget = d.budgets.get(cat.categoryId) ?? null;
    if (!budget || budget <= 0) continue;
    const projected = cat.total * scale;
    if (projected <= budget) continue;
    if (projected - budget < MIN_DELTA_RUPEES) continue;
    breaches.push({ name: cat.name, budget, projected });
  }

  if (breaches.length === 0) return [];
  breaches.sort((a, b) => b.projected - b.budget - (a.projected - a.budget));
  const overshoot = breaches.reduce((s, b) => s + (b.projected - b.budget), 0);
  const worst = breaches.slice(0, 3).map((b) => `${b.name} ${inr(b.projected)} vs ${inr(b.budget)}`);

  return [
    {
      id: 'budget-breach',
      type: d.isOpenMonth ? 'prediction' : 'anomaly',
      severity: 'warning',
      icon: '🚧',
      title: d.isOpenMonth ? 'Budgets on Track to Break' : 'Budgets Exceeded',
      description:
        `${plural(breaches.length, 'category')} ${d.isOpenMonth ? 'projected to end' : 'ended'} ` +
        `${inr(overshoot)} over budget in ${d.analysisLabel}: ${joinList(worst)}.`,
      value: overshoot,
      action: 'Either the budget is wrong or the spending is — pick one and change it.',
      weight: overshoot,
    },
  ];
};

/**
 * `needsTrustedMonth` rules compare the analysis month against something. They are
 * skipped entirely when the month is under-logged — the comparison would be measuring
 * the gap in the record rather than a change in behaviour.
 */
/**
 * - `needsTrustedMonth`: compares the analysis month against a baseline. Skipped when the
 *   month is under-logged — the comparison would measure the gap in the record rather
 *   than a change in behaviour.
 * - `needsCompleteMonth`: compares a whole-month figure against whole-month history.
 *   Skipped while the month is still running, where it would report a 23-day total as a
 *   triumph. `runRateRule` is what covers the open month, by scaling to month end.
 *
 * Rules marked neither are within-month shares (what fraction was Want, was Unplanned,
 * was one-time), which are meaningful at any point in the month.
 */
const RULES: Array<{ run: Rule; needsTrustedMonth: boolean; needsCompleteMonth: boolean }> = [
  { run: thinMonthRule, needsTrustedMonth: false, needsCompleteMonth: false },
  { run: dataQualityRule, needsTrustedMonth: false, needsCompleteMonth: false },
  { run: oneTimeLoadRule, needsTrustedMonth: false, needsCompleteMonth: false },
  { run: recurringBaselineRule, needsTrustedMonth: true, needsCompleteMonth: true },
  { run: unplannedShareRule, needsTrustedMonth: false, needsCompleteMonth: false },
  { run: budgetBreachRule, needsTrustedMonth: true, needsCompleteMonth: false },
  { run: categoryAnomalyRule, needsTrustedMonth: true, needsCompleteMonth: true },
  { run: wantShareRule, needsTrustedMonth: true, needsCompleteMonth: false },
  { run: needCreepRule, needsTrustedMonth: true, needsCompleteMonth: true },
  { run: catchAllRule, needsTrustedMonth: false, needsCompleteMonth: false },
  { run: yearOverYearRule, needsTrustedMonth: true, needsCompleteMonth: true },
  { run: concentrationRule, needsTrustedMonth: true, needsCompleteMonth: false },
  { run: weekendRule, needsTrustedMonth: true, needsCompleteMonth: false },
  { run: runRateRule, needsTrustedMonth: false, needsCompleteMonth: false },
  { run: nextMonthForecastRule, needsTrustedMonth: false, needsCompleteMonth: false },
  { run: annualForecastRule, needsTrustedMonth: false, needsCompleteMonth: false },
];

const SEVERITY_ORDER: Record<Insight['severity'], number> = { danger: 0, warning: 1, info: 2, success: 3 };

/**
 * Run every rule and rank. Severity first, then rupee weight — so the biggest
 * thing that happened is never pushed below the smallest thing that happened.
 */
export function buildExpenseInsights(data: PreparedExpenseData): Insight[] {
  const trusted = !data.month.lowConfidence;

  const insights = RULES.flatMap(({ run, needsTrustedMonth, needsCompleteMonth }) => {
    if (needsTrustedMonth && !trusted) return [];
    if (needsCompleteMonth && data.isOpenMonth) return [];
    try {
      return run(data);
    } catch {
      // One bad rule must not blank the page.
      return [];
    }
  });

  const ranked = insights.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return (b.weight ?? 0) - (a.weight ?? 0);
  });

  // Cap the page, but never at the cost of a danger/warning: those are kept in full
  // and the info/success tail is what gets trimmed.
  if (ranked.length <= MAX_INSIGHTS) return ranked;
  const serious = ranked.filter((i) => i.severity === 'danger' || i.severity === 'warning');
  const rest = ranked.filter((i) => i.severity !== 'danger' && i.severity !== 'warning');
  return [...serious, ...rest.slice(0, Math.max(0, MAX_INSIGHTS - serious.length))];
}
