import { differenceInCalendarDays } from 'date-fns';
import { parseAppDate } from '@/lib/utils/dateUtils';
import { resolveSipAmount, type SipFundSchedule } from './sipSchedule';

/**
 * Recognising a bank debit as a SIP instalment from the schedule itself.
 *
 * A SIP is a *declaration*: this fund, this amount, this day of the month. That is far
 * stronger evidence about where ₹10,000 went than "the last ₹10,000 on this account went
 * to X", and originally nothing read it until after an account had already been chosen.
 *
 * What that costs: say two ₹10,000 debits leave a bank account on the 11th and the 17th,
 * and the fund platform has mailed "Fund A ₹10,000 due 11th" and "Fund B ₹10,000 due 17th".
 * If an earlier ₹10,000 instalment was once filed to a brokerage wallet, `suggestAccount`
 * falls through to "same method, similar amount" and files both there too. Each mistake
 * then teaches the next, and every one of them double-counts: the virtual instalment stays
 * unclaimed *and* a real `portfolio_investments` row is written — even when every debit
 * that month matches a SIP exactly on amount and day, leaving no room for a wallet load.
 *
 * So the calendar is consulted first, across every account, and history only gets a turn
 * when the calendar says nothing. Pure and deterministic.
 */

/**
 * How far a debit may fall from the fund's due day. Observed in real data: anywhere from
 * 0 to 3 days — the mandate presents on the due date and the bank posts it when it posts
 * it. Five matches
 * `MANUAL_MATCH_DAYS`, which is the same question asked of a hand-entered row.
 */
export const SIP_DUE_WINDOW_DAYS = 5;

/** An instalment is a fixed mandate amount; a rupee of slack covers rounding, nothing more. */
export const SIP_AMOUNT_TOLERANCE = 1;

export interface SipScheduledFund extends SipFundSchedule {
  name?: string;
  active?: boolean;
  /** As stored on `/portfolio/sip`: "2nd", "11th", "17th" — or a plain number. */
  sip_date?: string | number | null;
}

export interface SipAccountSchedule {
  accountId: string;
  accountName: string;
  funds: readonly SipScheduledFund[];
}

export interface SipInstalmentMatch {
  accountId: string;
  accountName: string;
  fund: string;
  month: string;
  amount: number;
  /** The date the mandate was due, `yyyy-MM-dd`. */
  dueDate: string;
  daysFromDue: number;
}

/** The claim key a transfer holds: one instalment of one fund in one month. */
export const sipClaimKeyFor = (accountId: string, fund: string, month: string) => `${accountId}|${fund}|${month}`;

/** "11th" → 11, 2 → 2, "" / null / "last" → null. */
export function sipDueDay(value: unknown): number | null {
  const day = typeof value === 'number' ? value : parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

/**
 * The due date in a month, clamped to its length — a SIP on the 31st presents on 28 Feb,
 * which is also what the AMC does.
 */
export function sipDueDate(month: string, day: number): string {
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/**
 * The months a debit on `date` could be settling: its own, and either neighbour. A SIP due
 * on the 30th can post on the 2nd of the next month, and one due on the 2nd can post on the
 * last day of the previous one. Without this the instalment is invisible to the month the
 * bank happened to stamp on it.
 */
export function sipMonthsAround(date: string): string[] {
  const [year, month] = date.slice(0, 7).split('-').map(Number);
  return [-1, 0, 1].map((offset) => {
    const d = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export interface SipInstalmentHit {
  fund: string;
  month: string;
  amount: number;
  dueDate: string;
  daysFromDue: number;
}

/**
 * Every unclaimed instalment of one account's funds that this debit could be, nearest
 * due date first. A fund with no `sip_date` is still matched on amount within its own
 * month — the schedule is then only half declared, and half is better than nothing.
 */
export function findSipInstalments(params: {
  date: string;
  amount: number;
  funds: readonly SipScheduledFund[];
  /** `fund|month` keys another transfer already claimed on this account. */
  claimedSips: ReadonlySet<string>;
}): SipInstalmentHit[] {
  const { date, amount, funds, claimedSips } = params;
  if (amount <= 0) return [];
  const months = sipMonthsAround(date);
  const ownMonth = date.slice(0, 7);
  const hits: SipInstalmentHit[] = [];

  for (const fund of funds) {
    const name = typeof fund.name === 'string' ? fund.name.trim() : '';
    if (!name || fund.active === false) continue;
    const day = sipDueDay(fund.sip_date);

    for (const month of months) {
      // With no due day there is nothing to be near, so only the debit's own month counts.
      if (day === null && month !== ownMonth) continue;
      if (claimedSips.has(`${name}|${month}`)) continue;

      const instalment = resolveSipAmount(fund, month);
      if (instalment <= 0 || Math.abs(instalment - amount) > SIP_AMOUNT_TOLERANCE) continue;

      const dueDate = sipDueDate(month, day ?? 1);
      const daysFromDue = day === null ? 0 : Math.abs(differenceInCalendarDays(parseAppDate(date), parseAppDate(dueDate)));
      if (day !== null && daysFromDue > SIP_DUE_WINDOW_DAYS) continue;

      hits.push({ fund: name, month, amount: instalment, dueDate, daysFromDue });
    }
  }

  return hits.sort((a, b) => a.daysFromDue - b.daysFromDue || a.fund.localeCompare(b.fund));
}

/**
 * The one instalment this debit is, across every account that runs SIPs — or null.
 *
 * **Decided by the nearest due date, and only when that is decisive.** Someone running two
 * ₹5,000 SIPs — say Fund A on the 2nd and Fund B on the 6th — has a five-day window in
 * which a ₹5,000 debit touches both. Requiring a single hit would refuse every one of
 * them; taking the nearest settles it the way real data reads, the 2nd to Fund A and the
 * 6th to Fund B, and leaves the window wide enough for a bank holiday.
 *
 * A genuine tie falls to `preferAccountIds` — the owner's own folio accounts. The same
 * ₹2,500 SIP on the 15th can run under *both* members' accounts, and the
 * owner of the debited bank account is what tells them apart.
 *
 * Still null when nothing breaks the tie. A confident wrong account is worse than a blank
 * one: that is how SIP instalments end up credited to a brokerage wallet.
 */
export function matchSipAcrossAccounts(params: {
  date: string;
  amount: number;
  accounts: readonly SipAccountSchedule[];
  claimedSips: ReadonlySet<string>;
  /** Accounts belonging to the owner of the debited account, to break a tie. */
  preferAccountIds?: readonly string[];
}): SipInstalmentMatch | null {
  const { date, amount, accounts, claimedSips, preferAccountIds } = params;
  const matches: SipInstalmentMatch[] = [];

  for (const account of accounts) {
    const scoped = new Set(
      [...claimedSips]
        .filter((key) => key.startsWith(`${account.accountId}|`))
        .map((key) => key.slice(account.accountId.length + 1))
    );
    for (const hit of findSipInstalments({ date, amount, funds: account.funds, claimedSips: scoped })) {
      matches.push({ accountId: account.accountId, accountName: account.accountName, ...hit });
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => a.daysFromDue - b.daysFromDue);

  const nearest = matches[0].daysFromDue;
  const tied = matches.filter((m) => m.daysFromDue === nearest);
  if (tied.length === 1) return tied[0];

  const preferred = preferAccountIds?.length ? tied.filter((m) => preferAccountIds.includes(m.accountId)) : [];
  return preferred.length === 1 ? preferred[0] : null;
}

/** "the Example Small Cap Fund SIP instalment, due 11 Sep" — why the account was suggested. */
export function describeSipMatch(match: SipInstalmentMatch): string {
  const due = parseAppDate(match.dueDate);
  const label = due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `the ${match.fund} SIP instalment was due ${label}`;
}
