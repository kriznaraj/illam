/**
 * Selvam (portfolio) insight rules.
 *
 * Pure functions over a prepared window of snapshots, accounts and contributions.
 *
 * What this replaces: an engine that read exactly three snapshot dates, emitted
 * insights with no `id` and no `severity` (so every card rendered unstyled), and whose
 * only forward-looking number was `ytdGrowth × 12 / monthsElapsed` — an annualisation
 * of a run that could contain a double-digit drawdown month and a lakh-sized accounting artefact.
 *
 * The central idea here is that a rise in net worth is not a return. Money you added,
 * debt you repaid and assets that revalued are three different things, and only the
 * third is performance. Nothing in the app separated them before.
 */

import type { Insight } from '@/types';
import { resolveSipAmount, type SipFundSchedule } from '@/lib/portfolio/sipSchedule';
import { inr, inrShort, joinList, plural } from './format';
import { herfindahl, median, projectLinear } from './stats';

// --- thresholds -------------------------------------------------------------

/** A balance unchanged for this many consecutive months is being left un-updated. */
export const STALE_MONTHS = 3;
/** Below this, a movement is not worth a card on a portfolio this size. */
export const MIN_MATERIAL_RUPEES = 10_000;
/** Single-type share above this is a concentration worth naming. */
export const CONCENTRATION_SHARE = 0.35;
/** Herfindahl above this counts as concentrated rather than diversified. */
export const HHI_CONCENTRATED = 0.25;
/** Peak-to-trough deeper than this earns a card. */
export const DRAWDOWN_THRESHOLD = 0.10;
/** Net-worth milestones are called at every step of this size. */
export const MILESTONE_STEP = 25_00_000;

export const CREDIT_CARD_TYPE = 'Credit Card';
export const LOAN_TYPE = 'Loan';
/** Types that are liabilities and must be held as negative balances. */
export const LIABILITY_TYPES = [CREDIT_CARD_TYPE, LOAN_TYPE];

// --- shapes -----------------------------------------------------------------

export interface PortfolioAccountRow {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  details: Record<string, any> | null;
  /**
   * Cash (salary, savings): outside the investment boundary. See
   * `lib/portfolio/cashAccounts.ts`. Omitted is read as "not cash".
   */
  isCash?: boolean;
}

export interface SnapshotRow {
  accountId: string;
  /** yyyy-MM */
  month: string;
  amount: number;
  /** Full yyyy-MM-dd. Needed to break ties when a month has more than one snapshot. */
  date: string;
}

export interface InvestmentRow {
  accountId: string;
  /** yyyy-MM */
  month: string;
  amount: number;
  kind: string;
  note: string | null;
}

export interface AccountSeries {
  account: PortfolioAccountRow;
  /** month → balance, only months actually snapshotted. */
  byMonth: Map<string, number>;
  latest: number;
  latestMonth: string | null;
  /** Consecutive months at the end of the window with an identical balance. */
  staleMonths: number;
  /**
   * Months in which this account's balance moved after having been frozen for
   * `STALE_MONTHS` or more — month → the size of the jump and how long it had been
   * frozen. A backdated correction, not that month's performance.
   */
  catchUps: Map<string, { delta: number; frozenMonths: number }>;
}

export interface PreparedPortfolioData {
  /** yyyy-MM of the month being analysed. */
  analysisMonthKey: string;
  analysisLabel: string;
  /** Ascending list of months in the window. */
  months: string[];
  /** Net worth per month, aligned to `months`. Missing months carry forward. */
  netWorthByMonth: number[];
  /**
   * The investment accounts only — neither cash nor liabilities — aligned to `months`,
   * carried forward like net worth. Market gain is measured on this, not on net worth:
   * a move from the salary account into a brokerage changes it by exactly the contribution.
   */
  investedByMonth: number[];
  /** Per-type totals for the analysis month. */
  typeTotals: Record<string, number>;
  accounts: AccountSeries[];
  /**
   * Materialised contributions into investment accounts, keyed by the snapshot month
   * they *land in* — the month after the one they are dated in.
   *
   * A snapshot dated the 1st is the previous month's closing position (the 1 September
   * rows are typed in a few days later and hold the August statements). So a deposit
   * dated 7 August is inside the 08-01 → 09-01 move and is netted against the
   * September month, not against August, whose move it is no part of.
   */
  contributionsByMonth: Map<string, number>;
  /** Virtual SIP contributions, synthesised from `details.funds`, keyed like `contributionsByMonth`. */
  sipByMonth: Map<string, number>;
  /**
   * Per month, the part of the investment accounts' move that is a *catch-up
   * correction*: an account whose balance had been frozen for `STALE_MONTHS` or more
   * and then jumped in one step.
   *
   * For example, an EPF balance left unchanged from April to August and then updated on
   * 1 September: nothing earned that whole jump in September — five months of accrual
   * landed at once — but every month-level rule would read it as a single month of
   * market gain.
   */
  catchUpByMonth: Map<string, number>;
  monthsElapsed: number;
}

// --- preparation ------------------------------------------------------------

const monthKey = (isoDate: string) => isoDate.slice(0, 7);

/** Ascending list of yyyy-MM between two keys, inclusive. */
export function monthRange(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  let [y, m] = startKey.split('-').map(Number);
  while (`${y}-${String(m).padStart(2, '0')}` <= endKey) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 600) break;
  }
  return out;
}

/** A yyyy-MM key moved by whole months. */
export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * Inside the investment boundary: neither cash nor a liability. Contributions are money
 * crossing into these accounts, and market gain is measured on their balances alone.
 */
export function isInvestmentAccount(account: Pick<PortfolioAccountRow, 'type' | 'isCash'>): boolean {
  return !account.isCash && !LIABILITY_TYPES.includes(account.type);
}

export function preparePortfolioData(params: {
  accounts: PortfolioAccountRow[];
  snapshots: SnapshotRow[];
  investments: InvestmentRow[];
  startMonthKey: string;
  analysisMonthKey: string;
  analysisLabel: string;
}): PreparedPortfolioData {
  const { accounts, snapshots, investments, startMonthKey, analysisMonthKey, analysisLabel } = params;
  const months = monthRange(startMonthKey, analysisMonthKey);

  // `snapshot_date` is unique per (account, date), not per (account, month) — snapshots
  // are meant to sit on the 1st but a few do not. Taking the latest date within the month
  // is the only correct reading; summing them double-counts the account. That mistake
  // inflates one month's net worth and manufactures a drawdown the next month that never happened.
  const byAccount = new Map<string, Map<string, number>>();
  const chosenDate = new Map<string, string>();
  for (const s of snapshots) {
    if (s.month > analysisMonthKey) continue;
    let series = byAccount.get(s.accountId);
    if (!series) {
      series = new Map();
      byAccount.set(s.accountId, series);
    }
    const tieKey = `${s.accountId}|${s.month}`;
    const incumbent = chosenDate.get(tieKey);
    if (incumbent !== undefined && incumbent >= s.date) continue;
    chosenDate.set(tieKey, s.date);
    series.set(s.month, s.amount);
  }

  const series: AccountSeries[] = accounts.map((account) => {
    const byMonth = byAccount.get(account.id) ?? new Map<string, number>();
    const present = months.filter((m) => byMonth.has(m));
    const latestMonth = present.length ? present[present.length - 1] : null;
    const latest = latestMonth ? byMonth.get(latestMonth)! : 0;

    // Count back from the end of the window while the balance is unchanged. Only
    // months that were actually snapshotted count, so a gap is not mistaken for staleness.
    let staleMonths = 0;
    for (let i = present.length - 1; i >= 0; i--) {
      if (byMonth.get(present[i]) === latest) staleMonths++;
      else break;
    }

    return { account, byMonth, latest, latestMonth, staleMonths, catchUps: new Map() };
  });

  // Balances carry the last known value forward — matching how PortfolioReportService
  // fills gaps, so the two pages agree.
  const totalAt = (month: string, include: (s: AccountSeries) => boolean): number => {
    let total = 0;
    for (const s of series) {
      if (!include(s)) continue;
      let value: number | undefined;
      for (const m of months) {
        if (m > month) break;
        const v = s.byMonth.get(m);
        if (v !== undefined) value = v;
      }
      total += value ?? 0;
    }
    return total;
  };
  const netWorthByMonth = months.map((month) => totalAt(month, () => true));
  const investedByMonth = months.map((month) => totalAt(month, (s) => isInvestmentAccount(s.account)));

  const typeTotals: Record<string, number> = {};
  for (const s of series) {
    const value = s.byMonth.get(analysisMonthKey);
    if (value === undefined) continue;
    typeTotals[s.account.type] = (typeTotals[s.account.type] ?? 0) + value;
  }

  // Flows are keyed by the snapshot they land in: a row dated in month M sits inside the
  // move from the M snapshot to the M+1 one. Only rows into investment accounts count —
  // money booked against a cash account never crossed the boundary.
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  // Per account as well, so a catch-up can be told apart from money that simply arrived.
  const flowsByAccount = new Map<string, Map<string, number>>();
  const addFlow = (accountId: string, landsIn: string, amount: number) => {
    let byMonth = flowsByAccount.get(accountId);
    if (!byMonth) {
      byMonth = new Map();
      flowsByAccount.set(accountId, byMonth);
    }
    byMonth.set(landsIn, (byMonth.get(landsIn) ?? 0) + amount);
  };

  const contributionsByMonth = new Map<string, number>();
  for (const inv of investments) {
    const account = accountById.get(inv.accountId);
    if (!account || !isInvestmentAccount(account)) continue;
    const landsIn = shiftMonthKey(inv.month, 1);
    if (landsIn > analysisMonthKey || landsIn < startMonthKey) continue;
    contributionsByMonth.set(landsIn, (contributionsByMonth.get(landsIn) ?? 0) + inv.amount);
    addFlow(inv.accountId, landsIn, inv.amount);
  }

  // SIP contributions are never stored — they are synthesised per month from the
  // account's fund schedule. Omitting them understates what was added and silently
  // reclassifies every missing rupee as "market gain".
  const sipByMonth = new Map<string, number>();
  for (const account of accounts) {
    if (!isInvestmentAccount(account)) continue;
    const funds = (account.details?.funds ?? []) as Array<SipFundSchedule & { active?: boolean }>;
    if (!Array.isArray(funds) || funds.length === 0) continue;
    for (const landsIn of months) {
      const paidIn = shiftMonthKey(landsIn, -1);
      let total = 0;
      for (const fund of funds) {
        if (fund?.active === false) continue;
        total += resolveSipAmount(fund, paidIn);
      }
      if (total > 0) {
        sipByMonth.set(landsIn, (sipByMonth.get(landsIn) ?? 0) + total);
        addFlow(account.id, landsIn, total);
      }
    }
  }

  // A balance that has been flat for STALE_MONTHS or more and then moves is a
  // backdated correction, not a month's performance. Attribute it to the month it
  // landed in so month-level rules can report it separately instead of crediting it
  // to the market. Per account for every account; summed for investment accounts,
  // since that is the balance market gain is measured on.
  const catchUpByMonth = new Map<string, number>();
  for (const s of series) {
    const present = months.filter((m) => s.byMonth.has(m));
    let flatLen = 1; // snapshotted months, inclusive, at the value ending at present[i - 1]
    for (let i = 1; i < present.length; i++) {
      const previous = s.byMonth.get(present[i - 1])!;
      const value = s.byMonth.get(present[i])!;
      if (value === previous) {
        flatLen++;
        continue;
      }
      if (flatLen >= STALE_MONTHS) {
        // Net of every rupee that landed in this account while the balance sat still, not
        // just in this step. An account that sits flat and then rises by exactly its
        // contribution (say a ₹25,000 deposit) has seen the contribution, not a catch-up. An
        // EPF balance that sits flat for months while its monthly contributions keep landing
        // — each already subtracted in its own month — jumps by all of them at once; netting
        // only the final month's would take the earlier ones off a second time.
        const flows = flowsByAccount.get(s.account.id);
        const frozeAt = i - flatLen >= 0 ? present[i - flatLen] : '';
        const arrived = flows
          ? months.filter((m) => m > frozeAt && m <= present[i]).reduce((sum, m) => sum + (flows.get(m) ?? 0), 0)
          : 0;
        const delta = value - previous - arrived;
        if (Math.abs(delta) >= 0.005) {
          s.catchUps.set(present[i], { delta, frozenMonths: flatLen });
          if (isInvestmentAccount(s.account)) {
            catchUpByMonth.set(present[i], (catchUpByMonth.get(present[i]) ?? 0) + delta);
          }
        }
      }
      flatLen = 1;
    }
  }

  return {
    analysisMonthKey,
    analysisLabel,
    months,
    netWorthByMonth,
    investedByMonth,
    typeTotals,
    accounts: series,
    contributionsByMonth,
    sipByMonth,
    catchUpByMonth,
    monthsElapsed: months.length,
  };
}

// --- helpers ----------------------------------------------------------------

const sumValues = (m: Map<string, number>) => Array.from(m.values()).reduce((a, b) => a + b, 0);

function netWorthAt(d: PreparedPortfolioData, index: number): number {
  return d.netWorthByMonth[index] ?? 0;
}

export interface GrowthDecomposition {
  start: number;
  end: number;
  change: number;
  /** Money that crossed into investment accounts: stored contributions and virtual SIPs. */
  contributed: number;
  /** Frozen investment balances finally updated: accrual from earlier months, not gain. */
  catchUp: number;
  /** What the investment accounts did beyond the money put in and the catch-ups. */
  marketGain: number;
  /** New money into net worth: contributions, what cash balances did, debt repaid. */
  saved: number;
  debtRepaid: number;
  signArtefact: number;
}

/**
 * How net worth moved between two months of the window, split so that nothing is
 * counted twice:  change = marketGain + catchUp + saved + signArtefact.
 *
 * Market gain is measured on the investment accounts: their move, less the money that
 * crossed into them, less catch-ups. A ₹40,000 transfer from the salary account into
 * a brokerage raises the investment accounts by ₹40,000 and is subtracted as a
 * contribution, so it is no gain; cash falls by the same ₹40,000, so it is no saving
 * either. Measuring gain on net worth instead — what this engine used to do — subtracted
 * that transfer from a total it had never been added to.
 *
 * The annual review uses this too, so the two pages cannot drift apart.
 */
export function decomposeGrowth(d: PreparedPortfolioData, fromIndex: number, toIndex: number): GrowthDecomposition {
  const start = netWorthAt(d, fromIndex);
  const end = netWorthAt(d, toIndex);
  const change = end - start;

  // Flows are keyed by the snapshot they land in, so the move into `toIndex` starts one after `fromIndex`.
  const landing = d.months.slice(fromIndex + 1, toIndex + 1);
  const across = (byMonth: Map<string, number>) => landing.reduce((sum, month) => sum + (byMonth.get(month) ?? 0), 0);
  const contributed = across(d.contributionsByMonth) + across(d.sipByMonth);
  const catchUp = across(d.catchUpByMonth);
  const investedChange = (d.investedByMonth[toIndex] ?? 0) - (d.investedByMonth[fromIndex] ?? 0);
  const marketGain = investedChange - contributed - catchUp;

  const fromMonth = d.months[fromIndex];
  const toMonth = d.months[toIndex];
  const typeAt = (type: string, month: string) =>
    d.accounts.filter((s) => s.account.type === type).reduce((sum, s) => sum + (s.byMonth.get(month) ?? 0), 0);

  // Debt repayment raises net worth without any asset appreciating: it is saving.
  const debtRepaid = typeAt(LOAN_TYPE, toMonth) - typeAt(LOAN_TYPE, fromMonth);
  // Credit cards stored positive inflate the change; quantify it so it is never called saving.
  const ccStart = typeAt(CREDIT_CARD_TYPE, fromMonth);
  const ccEnd = typeAt(CREDIT_CARD_TYPE, toMonth);
  const signArtefact = ccStart < 0 && ccEnd > 0 ? ccEnd - ccStart : 0;

  return {
    start,
    end,
    change,
    contributed,
    catchUp,
    marketGain,
    saved: change - marketGain - catchUp - signArtefact,
    debtRepaid,
    signArtefact,
  };
}

/**
 * Median new saving per month over the last `count` moves. With zero market return this
 * is all net worth grows by, so it — not contributions, which mostly move money out of
 * cash that net worth already counts — is the floor of a projection.
 */
export function recentMonthlySavings(d: PreparedPortfolioData, count = 6): number {
  const saved: number[] = [];
  for (let i = Math.max(1, d.months.length - count); i < d.months.length; i++) {
    saved.push(decomposeGrowth(d, i - 1, i).saved);
  }
  return median(saved);
}

/** Total of every liability line in the analysis month, as a positive magnitude. */
function liabilityMagnitude(d: PreparedPortfolioData): number {
  return d.accounts
    .filter((s) => LIABILITY_TYPES.includes(s.account.type))
    .reduce((sum, s) => sum + Math.abs(s.byMonth.get(d.analysisMonthKey) ?? 0), 0);
}

// --- rules ------------------------------------------------------------------

type Rule = (data: PreparedPortfolioData) => Insight[];

/**
 * Credit-card balances stored as positive numbers.
 *
 * A card balance is money owed. Stored positive it is summed into net worth as an
 * asset, so paying the card down *reduces* reported net worth and running one up
 * increases it. The error is worth twice the balance: once for not subtracting, once
 * for adding.
 */
const creditCardSignRule: Rule = (d) => {
  const offenders = d.accounts
    .map((s) => ({ s, value: s.byMonth.get(d.analysisMonthKey) }))
    .filter((x) => x.s.account.type === CREDIT_CARD_TYPE && (x.value ?? 0) > 0);
  if (offenders.length === 0) return [];

  const total = offenders.reduce((sum, x) => sum + (x.value ?? 0), 0);
  if (total < MIN_MATERIAL_RUPEES) return [];
  const overstatement = total * 2;
  const names = offenders
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 4)
    .map((x) => `${x.s.account.name} ${inr(x.value ?? 0)}`);

  return [
    {
      id: 'cc-sign-anomaly',
      type: 'data_quality',
      severity: 'danger',
      icon: '🚨',
      title: 'Credit Card Balances Have the Wrong Sign',
      description:
        `${plural(offenders.length, 'card')} carry a positive balance in ${d.analysisLabel}, ` +
        `totalling ${inr(total)}: ${joinList(names)}. A card balance is money owed, so it should be ` +
        `negative. Stored this way it is added to net worth instead of subtracted — ` +
        `${d.analysisLabel} net worth is overstated by about ${inr(overstatement)}, and paying a card ` +
        `off would show up as a loss.`,
      value: overstatement,
      action: 'Re-enter these as negative amounts on /portfolio/snapshots.',
      weight: overstatement,
    },
  ];
};

/** Balances nobody has updated. Everything downstream is computed on these numbers. */
const staleSnapshotRule: Rule = (d) => {
  const stale = d.accounts
    .filter((s) => s.account.isActive && s.staleMonths >= STALE_MONTHS && Math.abs(s.latest) >= MIN_MATERIAL_RUPEES)
    .sort((a, b) => Math.abs(b.latest) - Math.abs(a.latest));
  if (stale.length === 0) return [];

  const frozenValue = stale.reduce((sum, s) => sum + Math.abs(s.latest), 0);
  const worst = stale
    .slice(0, 4)
    .map((s) => `${s.account.name} (${inrShort(s.latest)}, ${plural(s.staleMonths, 'month')})`);

  return [
    {
      id: 'stale-snapshots',
      type: 'data_quality',
      severity: frozenValue > sumValues(d.contributionsByMonth) ? 'warning' : 'info',
      icon: '🧊',
      title: 'Balances Have Stopped Moving',
      description:
        `${plural(stale.length, 'active account')} holding ${inrShort(frozenValue)} have carried the same ` +
        `balance for ${STALE_MONTHS} months or more: ${joinList(worst)}. ` +
        `Every growth figure on this page is computed on those numbers.`,
      value: frozenValue,
      action: 'Update them on /portfolio/snapshots before reading anything into the trend.',
      weight: frozenValue * 0.1,
    },
  ];
};

/**
 * Accounts told to expect a monthly contribution whose balance never moves.
 * The two Selvam data sources are contradicting each other and nothing said so.
 */
const contributionContradictionRule: Rule = (d) => {
  const offenders: Array<{ name: string; monthly: number; stale: number; latest: number }> = [];
  for (const s of d.accounts) {
    if (!s.account.isActive) continue;
    if (!s.account.details?.recurring_investments_enabled) continue;
    const monthly = Number(s.account.details?.recurring_monthly_amount ?? 0);
    if (!Number.isFinite(monthly) || monthly <= 0) continue;
    if (s.staleMonths < STALE_MONTHS) continue;
    offenders.push({ name: s.account.name, monthly, stale: s.staleMonths, latest: s.latest });
  }
  if (offenders.length === 0) return [];

  const missing = offenders.reduce((sum, o) => sum + o.monthly * o.stale, 0);
  const lines = offenders.map(
    (o) => `${o.name} — ${inr(o.monthly)}/month recorded, balance frozen at ${inrShort(o.latest)} for ${plural(o.stale, 'month')}`
  );

  return [
    {
      id: 'contribution-contradiction',
      type: 'data_quality',
      severity: 'warning',
      icon: '🔀',
      title: 'Contributions Recorded but Balances Flat',
      description:
        `${joinList(lines)}. Contributions and snapshots are separate records and they disagree: ` +
        `roughly ${inr(missing)} has gone in without appearing in any balance.`,
      value: missing,
      action: 'Either the snapshot is out of date or the recurring contribution is no longer running — reconcile the two.',
      weight: missing,
    },
  ];
};

/**
 * The headline analysis: how much of the change was performance and how much was
 * simply money going in. This did not exist, and it is the only number that answers
 * "am I actually doing well".
 */
const contributionVsGrowthRule: Rule = (d) => {
  if (d.months.length < 4) return [];
  const g = decomposeGrowth(d, 0, d.months.length - 1);
  if (Math.max(Math.abs(g.change), Math.abs(g.marketGain)) < MIN_MATERIAL_RUPEES) return [];

  const beyondSaving = [
    `${g.marketGain >= 0 ? 'markets added' : 'markets took'} ${inrShort(Math.abs(g.marketGain))} on the investment accounts`,
    Math.abs(g.catchUp) >= MIN_MATERIAL_RUPEES
      ? `${inrShort(Math.abs(g.catchUp))} was a catch-up on balances that had been frozen for months`
      : null,
    g.signArtefact > 0 ? `${inrShort(g.signArtefact)} is the credit-card sign error above, not real money` : null,
  ].filter(Boolean) as string[];
  const savingParts = [
    `${inrShort(g.contributed)} put into investments`,
    g.debtRepaid > 0 ? `${inrShort(g.debtRepaid)} of loan repaid` : null,
  ].filter(Boolean) as string[];

  return [
    {
      id: 'contribution-vs-growth',
      type: 'performance',
      severity: g.marketGain < 0 ? 'warning' : 'info',
      icon: '⚖️',
      title: 'What Actually Drove the Growth',
      description:
        `Net worth moved ${inrShort(g.start)} → ${inrShort(g.end)} over ${plural(d.months.length - 1, 'month')} ` +
        `(${g.change >= 0 ? '+' : ''}${inrShort(g.change)}). Of that, ${joinList(beyondSaving)}. ` +
        `The other ${inrShort(g.saved)} is saving — ${joinList(savingParts)}, with cash balances making up the rest. ` +
        `Money moved from a bank account into investments is not counted twice: it is a contribution, not growth.`,
      value: g.marketGain,
      change: g.start > 0 ? (g.change / g.start) * 100 : null,
      weight: Math.abs(g.change),
    },
  ];
};

/** Debt is the one line whose direction is fully under your control. */
const liabilityPaydownRule: Rule = (d) => {
  const loans = d.accounts.filter((s) => s.account.type === LOAN_TYPE);
  if (loans.length === 0) return [];
  const start = loans.reduce((sum, s) => sum + (s.byMonth.get(d.months[0]) ?? 0), 0);
  const end = loans.reduce((sum, s) => sum + (s.byMonth.get(d.analysisMonthKey) ?? 0), 0);
  if (end >= 0) return [];
  const repaid = end - start;
  if (Math.abs(repaid) < MIN_MATERIAL_RUPEES) return [];

  // Recent pace, not the whole window: rates change.
  const recent = d.months.slice(-7);
  const recentBalances = recent
    .map((m) => loans.reduce((sum, s) => sum + (s.byMonth.get(m) ?? 0), 0))
    .filter((v) => v !== 0);
  const monthlyPace =
    recentBalances.length >= 2
      ? (recentBalances[recentBalances.length - 1] - recentBalances[0]) / (recentBalances.length - 1)
      : 0;
  const monthsToClear = monthlyPace > 0 ? Math.abs(end) / monthlyPace : 0;

  const projection =
    monthsToClear > 0 && monthsToClear < 600
      ? ` At the recent pace of ${inr(monthlyPace)} a month, it clears in about ${Math.round(monthsToClear / 12)} years.`
      : '';

  return [
    {
      id: 'liability-paydown',
      type: 'trend',
      severity: repaid > 0 ? 'success' : 'warning',
      icon: repaid > 0 ? '🏦' : '⚠️',
      title: repaid > 0 ? 'Debt Is Coming Down' : 'Debt Is Growing',
      description:
        `Loan balance moved ${inrShort(Math.abs(start))} → ${inrShort(Math.abs(end))} across ` +
        `${plural(d.months.length - 1, 'month')} — ${inrShort(Math.abs(repaid))} ${repaid > 0 ? 'repaid' : 'added'}.` +
        projection,
      value: Math.abs(end),
      change: start !== 0 ? (repaid / Math.abs(start)) * 100 : null,
      weight: Math.abs(repaid),
    },
  ];
};

/** The worst peak-to-trough in the window, so a good year is not read as a straight line. */
const drawdownRule: Rule = (d) => {
  if (d.netWorthByMonth.length < 4) return [];
  let peak = d.netWorthByMonth[0];
  let peakMonth = d.months[0];
  let worst = 0;
  let worstPeak = peak;
  let worstPeakMonth = peakMonth;
  let worstTrough = peak;
  let worstTroughMonth = peakMonth;

  for (let i = 1; i < d.netWorthByMonth.length; i++) {
    const value = d.netWorthByMonth[i];
    if (value > peak) {
      peak = value;
      peakMonth = d.months[i];
      continue;
    }
    const dd = peak > 0 ? (peak - value) / peak : 0;
    if (dd > worst) {
      worst = dd;
      worstPeak = peak;
      worstPeakMonth = peakMonth;
      worstTrough = value;
      worstTroughMonth = d.months[i];
    }
  }

  if (worst < DRAWDOWN_THRESHOLD) return [];

  return [
    {
      id: 'drawdown',
      type: 'performance',
      severity: worst > 0.2 ? 'warning' : 'info',
      icon: '📉',
      title: 'Largest Drop in the Window',
      description:
        `Net worth fell ${(worst * 100).toFixed(0)}% from ${inrShort(worstPeak)} in ${worstPeakMonth} to ` +
        `${inrShort(worstTrough)} in ${worstTroughMonth} — ${inrShort(worstPeak - worstTrough)} on paper. ` +
        `Worth knowing before sizing the next position.`,
      value: worstPeak - worstTrough,
      change: -worst * 100,
      weight: (worstPeak - worstTrough) * 0.5,
    },
  ];
};

/** Concentration by Herfindahl, not by counting how many boxes exist. */
const concentrationRule: Rule = (d) => {
  const assetTypes = Object.entries(d.typeTotals).filter(([type, value]) => !LIABILITY_TYPES.includes(type) && value > 0);
  if (assetTypes.length === 0) return [];
  const gross = assetTypes.reduce((sum, [, v]) => sum + v, 0);
  if (gross <= 0) return [];

  const hhi = herfindahl(assetTypes.map(([, v]) => v));
  const sorted = assetTypes.sort((a, b) => b[1] - a[1]);
  const [topType, topValue] = sorted[0];
  const topShare = topValue / gross;

  const concentrated = hhi > HHI_CONCENTRATED || topShare > CONCENTRATION_SHARE;

  const breakdown = sorted
    .slice(0, 3)
    .map(([t, v]) => `${t} ${inrShort(v)} (${((v / gross) * 100).toFixed(0)}%)`);

  return [
    {
      id: concentrated ? 'concentration-risk' : 'diversification',
      type: 'diversification',
      severity: concentrated ? 'warning' : 'info',
      icon: concentrated ? '🎯' : '🌈',
      title: concentrated ? `Concentrated in ${topType}` : 'Reasonably Spread',
      description:
        `${inrShort(gross)} of gross assets across ${plural(assetTypes.length, 'type')}: ${joinList(breakdown)}. ` +
        (concentrated
          ? `${topType} alone is ${(topShare * 100).toFixed(0)}%, so the portfolio moves largely with it.`
          : `No single type dominates.`),
      value: topValue,
      change: topShare * 100,
      weight: concentrated ? topValue * 0.2 : 1,
    },
  ];
};

/** Indian financial year, matching the dashboard. The old engine used the calendar year. */
const fyProgressRule: Rule = (d) => {
  const [yearStr, monthStr] = d.analysisMonthKey.split('-');
  const year = Number(yearStr);
  const monthNo = Number(monthStr);
  const fyStartYear = monthNo >= 4 ? year : year - 1;
  const fyStartKey = `${fyStartYear}-04`;
  const index = d.months.indexOf(fyStartKey);
  if (index === -1 || index === d.months.length - 1) return [];

  const start = netWorthAt(d, index);
  const end = netWorthAt(d, d.months.length - 1);
  if (start <= 0) return [];
  const change = end - start;
  const changePercent = (change / start) * 100;
  const monthsIn = d.months.length - index;

  return [
    {
      id: 'fy-progress',
      type: 'trend',
      severity: change >= 0 ? 'success' : 'warning',
      icon: change >= 0 ? '📈' : '📉',
      title: `FY${fyStartYear}–${String(fyStartYear + 1).slice(2)} So Far`,
      description:
        `${plural(monthsIn, 'month')} into the financial year, net worth has moved ` +
        `${inrShort(start)} → ${inrShort(end)} (${change >= 0 ? '+' : ''}${inrShort(change)}, ` +
        `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%).`,
      value: end,
      change: changePercent,
      weight: Math.abs(change) * 0.5,
    },
  ];
};

/**
 * Forward projection as a range with a floor, replacing `ytdGrowth × 12/monthsElapsed`.
 *
 * The floor is what net worth reaches on contributions alone at zero return — the part
 * that does not depend on markets. The upper figure is a least-squares fit on the
 * trailing months. Both assumptions are stated in the text, because a projection whose
 * assumptions are hidden is just a number.
 */
const projectionRule: Rule = (d) => {
  if (d.netWorthByMonth.length < 6) return [];
  const current = netWorthAt(d, d.netWorthByMonth.length - 1);
  if (current <= 0) return [];

  const HORIZON = 12;
  const trailing = d.netWorthByMonth.slice(-12);
  const fitted = projectLinear(trailing, HORIZON);

  // Savings floor: recent new saving per month, held flat, no return at all. Not
  // contributions — most of those move money out of a bank balance net worth already counts.
  const monthlySaved = recentMonthlySavings(d);
  const floor = current + monthlySaved * HORIZON;

  const low = Math.min(floor, fitted);
  const high = Math.max(floor, fitted);
  if (high - low < MIN_MATERIAL_RUPEES) return [];

  return [
    {
      id: 'net-worth-projection',
      type: 'projection',
      severity: 'info',
      icon: '🔭',
      title: 'Twelve Months Out',
      description:
        `From ${inrShort(current)} today, twelve months lands somewhere around ` +
        `${inrShort(low)}–${inrShort(high)}. The lower figure assumes only your recent ` +
        `${inr(monthlySaved)}/month of new saving and zero market return; the upper ` +
        `is a straight-line extension of the last ${plural(trailing.length, 'month')}. ` +
        `Neither is a forecast of markets — they bracket what arithmetic can say.`,
      value: high,
      change: current > 0 ? ((high - current) / current) * 100 : null,
      weight: Math.abs(high - current) * 0.3,
    },
  ];
};

/** Month-on-month move, with the contribution netted out. */
const monthMoveRule: Rule = (d) => {
  const n = d.netWorthByMonth.length;
  if (n < 2) return [];
  // A long-frozen balance that just moved is months of accrual landing at once, not
  // this month's performance. Left in, a months-late EPF correction reads as a
  // single spectacular month — decomposeGrowth separates it as `catchUp`.
  const g = decomposeGrowth(d, n - 2, n - 1);
  const current = g.end;
  const prev = g.start;
  const change = g.change;
  if (Math.abs(change) < MIN_MATERIAL_RUPEES) return [];
  const changePercent = prev > 0 ? (change / prev) * 100 : 0;
  // The rest of the saving: what cash balances and debt did besides funding contributions.
  // Without it the parts would not add up to the move, and a bank transfer into
  // investments would read as money appearing from nowhere.
  const cashAndDebt = g.saved - g.contributed;
  const material = (value: number) => Math.abs(value) >= MIN_MATERIAL_RUPEES;

  const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const breakdown = g.contributed > 0 || material(g.catchUp) || material(cashAndDebt) || g.signArtefact > 0
    ? `. ${capitalise(joinList([
        g.contributed > 0 ? `you put in ${inrShort(g.contributed)}` : null,
        material(g.catchUp)
          ? `${inrShort(Math.abs(g.catchUp))} is a catch-up on balances that had been frozen for months`
          : null,
        `${g.marketGain >= 0 ? 'markets added' : 'markets took'} ${inrShort(Math.abs(g.marketGain))}`,
        material(cashAndDebt) ? `cash and debt ${cashAndDebt >= 0 ? 'added' : 'took'} ${inrShort(Math.abs(cashAndDebt))}` : null,
        g.signArtefact > 0 ? `${inrShort(g.signArtefact)} is the credit-card sign error` : null,
      ].filter(Boolean) as string[]))}.`
    : '.';

  return [
    {
      id: 'month-move',
      type: 'trend',
      severity: change >= 0 ? 'success' : 'warning',
      icon: change >= 0 ? '📈' : '📉',
      title: change >= 0 ? 'Net Worth Rose This Month' : 'Net Worth Fell This Month',
      description:
        `${d.analysisLabel} moved ${change >= 0 ? '+' : ''}${inrShort(change)} (${changePercent >= 0 ? '+' : ''}` +
        `${changePercent.toFixed(1)}%) to ${inrShort(current)}` +
        breakdown,
      value: current,
      change: changePercent,
      weight: Math.abs(change),
    },
  ];
};

/** Milestones at every ₹25L, rather than a hardcoded ₹10L long since passed. */
const milestoneRule: Rule = (d) => {
  const n = d.netWorthByMonth.length;
  if (n < 2) return [];
  const current = netWorthAt(d, n - 1);
  const prev = netWorthAt(d, n - 2);
  const crossed = Math.floor(current / MILESTONE_STEP);
  if (crossed <= 0 || crossed === Math.floor(prev / MILESTONE_STEP)) return [];

  const next = (crossed + 1) * MILESTONE_STEP;
  return [
    {
      id: 'milestone',
      type: 'achievement',
      severity: 'success',
      icon: '🎯',
      title: 'Milestone Crossed',
      description:
        `Net worth passed ${inrShort(crossed * MILESTONE_STEP)} in ${d.analysisLabel}, reaching ` +
        `${inrShort(current)}. Next step is ${inrShort(next)}, ${inrShort(next - current)} away.`,
      value: current,
      weight: MIN_MATERIAL_RUPEES,
    },
  ];
};

/** The single account that moved most in rupees — not in percent off a tiny base. */
const topMoverRule: Rule = (d) => {
  const n = d.months.length;
  if (n < 2) return [];
  const prevMonth = d.months[n - 2];
  const moves = d.accounts
    .filter((s) => !LIABILITY_TYPES.includes(s.account.type))
    .map((s) => {
      const now = s.byMonth.get(d.analysisMonthKey);
      const before = s.byMonth.get(prevMonth);
      if (now === undefined || before === undefined) return null;
      return { name: s.account.name, delta: now - before, now, before, series: s };
    })
    .filter(Boolean) as Array<{
    name: string;
    delta: number;
    now: number;
    before: number;
    series: AccountSeries;
  }>;
  if (moves.length === 0) return [];

  const top = moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  if (Math.abs(top.delta) < MIN_MATERIAL_RUPEES) return [];

  // The biggest mover is often an account that was simply not being updated: an EPF
  // balance left flat for months and then posting all its accrual at once. Calling that the
  // month's top performer without saying what it is turns neglect into good news.
  const catchUp = top.series.catchUps.get(d.analysisMonthKey);

  return [
    {
      id: 'top-mover',
      type: 'performance',
      severity: 'info',
      icon: top.delta >= 0 ? '⭐' : '🔻',
      title: `${top.name} Moved Most`,
      description:
        `${top.name} went ${inrShort(top.before)} → ${inrShort(top.now)} in ${d.analysisLabel}, ` +
        `${top.delta >= 0 ? 'up' : 'down'} ${inrShort(Math.abs(top.delta))}. ` +
        `That is the largest single move of the month in rupee terms.` +
        (catchUp
          ? ` It had been frozen at ${inrShort(top.before)} for ${plural(catchUp.frozenMonths, 'month')}, ` +
            `so this is that whole stretch landing at once rather than one month's performance.`
          : ''),
      value: top.now,
      change: top.before !== 0 ? (top.delta / Math.abs(top.before)) * 100 : null,
      weight: Math.abs(top.delta) * 0.4,
    },
  ];
};

const RULES: Rule[] = [
  creditCardSignRule,
  contributionContradictionRule,
  staleSnapshotRule,
  contributionVsGrowthRule,
  monthMoveRule,
  drawdownRule,
  concentrationRule,
  liabilityPaydownRule,
  fyProgressRule,
  projectionRule,
  topMoverRule,
  milestoneRule,
];

const SEVERITY_ORDER: Record<Insight['severity'], number> = { danger: 0, warning: 1, info: 2, success: 3 };

export function buildPortfolioInsights(data: PreparedPortfolioData): Insight[] {
  return RULES.flatMap((rule) => {
    try {
      return rule(data);
    } catch {
      return [];
    }
  }).sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return (b.weight ?? 0) - (a.weight ?? 0);
  });
}

/** Exported for the annual review, which shows the same decomposition. */
export function portfolioSummary(d: PreparedPortfolioData) {
  const n = d.netWorthByMonth.length;
  const current = netWorthAt(d, n - 1);
  const prev = n >= 2 ? netWorthAt(d, n - 2) : current;
  const growth = decomposeGrowth(d, 0, Math.max(0, n - 1));

  return {
    totalNetWorth: current,
    monthGrowth: prev > 0 ? Number((((current - prev) / prev) * 100).toFixed(1)) : 0,
    monthChange: current - prev,
    windowMonths: d.months.length,
    windowStart: netWorthAt(d, 0),
    windowChange: current - netWorthAt(d, 0),
    contributed: growth.contributed,
    marketGain: growth.marketGain,
    saved: growth.saved,
    liabilities: liabilityMagnitude(d),
    typeTotals: d.typeTotals,
  };
}
