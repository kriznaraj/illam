import { describe, it, expect } from 'vitest';
import {
  findSipInstalments,
  matchSipAcrossAccounts,
  sipDueDate,
  sipDueDay,
  sipMonthsAround,
  type SipAccountSchedule,
} from '../sipMatch';

/**
 * Bob's live Groww/ET Money schedule and Alice's MF Central one, as stored on
 * 2026-09-27. These are the fixtures because they are the case that went wrong: six
 * September debits off HDFC ••1303 match these six Groww funds one-for-one on amount and
 * day, and two of them were nonetheless filed to a Kite wallet.
 */
const BOB_FUNDS = [
  { name: 'ICICI Quant Fund', sip_date: '2nd', sip_amount: 1000 },
  { name: 'Nippon India Pharma Fund', sip_date: '2nd', sip_amount: 5000, amount_history: [{ from_month: '2025-04', amount: 2000 }, { from_month: '2026-06', amount: 5000 }] },
  { name: 'Parag Parikh Flexi Cap', sip_date: '6th', sip_amount: 5000 },
  { name: 'WhiteOak Mid Cap', sip_date: '17th', sip_amount: 10000, amount_history: [{ from_month: '2025-04', amount: 5000 }, { from_month: '2026-06', amount: 10000 }] },
  { name: 'Bandhan Small Cap Fund', sip_date: '11th', sip_amount: 10000, amount_history: [{ from_month: '2025-04', amount: 3000 }, { from_month: '2026-06', amount: 10000 }] },
  { name: 'Motilal Oswal Nifty Capital Market Index Fund', sip_date: '5th', sip_amount: 4000, amount_history: [{ from_month: '2025-04', amount: 2000 }, { from_month: '2026-06', amount: 4000 }] },
  { name: 'Canara Robeco BlueChip', sip_date: '15th', sip_amount: 0, active: false },
  { name: 'Mirae Large & Midcap Fund', sip_date: '15th', sip_amount: 2500 },
  { name: 'ICICI Prudential Tech Fund', sip_date: '16th', sip_amount: 1000 },
];

const ALICE_FUNDS = [
  { name: 'Kotak Emerging Equity Fund', sip_date: '20th', sip_amount: 1000 },
  { name: 'Axis Bluechip Fund', sip_date: '20th', sip_amount: 0, active: false },
  { name: 'Axis Midcap Fund', sip_date: '20th', sip_amount: 2000 },
  { name: 'Mirae Large & Midcap Fund', sip_date: '15th', sip_amount: 2500 },
];

const BOB_MF = 'acct-bob-mf';
const ALICE_MF = 'acct-alice-mf';

const ACCOUNTS: SipAccountSchedule[] = [
  { accountId: BOB_MF, accountName: 'Bob Mutual Fund', funds: BOB_FUNDS },
  { accountId: ALICE_MF, accountName: 'Alice MF (MF Central)', funds: ALICE_FUNDS },
];

const match = (date: string, amount: number, claimed: string[] = [], prefer?: string[]) =>
  matchSipAcrossAccounts({ date, amount, accounts: ACCOUNTS, claimedSips: new Set(claimed), preferAccountIds: prefer });

describe('sipDueDay', () => {
  it.each([
    ['2nd', 2],
    ['11th', 11],
    ['17th', 17],
    [20, 20],
    ['', null],
    [null, null],
    ['last', null],
    ['32nd', null],
  ])('reads %s as %s', (value, expected) => {
    expect(sipDueDay(value)).toBe(expected);
  });
});

describe('sipDueDate', () => {
  it('clamps a late day to the length of the month, as the AMC does', () => {
    expect(sipDueDate('2026-02', 31)).toBe('2026-02-28');
    expect(sipDueDate('2026-09', 11)).toBe('2026-09-11');
  });
});

describe('sipMonthsAround', () => {
  it('spans the neighbouring months, so a debit posted late still finds its mandate', () => {
    expect(sipMonthsAround('2026-01-02')).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('matchSipAcrossAccounts — the six September debits off HDFC ••1303', () => {
  /*
   * Groww mailed an "instalment due" for each of these and allocated units a day or two
   * later. The last two were filed to Kite Wallet - Bob; this is what should have
   * happened instead.
   */
  it.each([
    ['2026-09-02', 1000, 'ICICI Quant Fund'],
    ['2026-09-02', 5000, 'Nippon India Pharma Fund'],
    ['2026-09-05', 4000, 'Motilal Oswal Nifty Capital Market Index Fund'],
    ['2026-09-06', 5000, 'Parag Parikh Flexi Cap'],
    ['2026-09-11', 10000, 'Bandhan Small Cap Fund'],
    ['2026-09-17', 10000, 'WhiteOak Mid Cap'],
  ])('%s ₹%s is the %s instalment', (date, amount, fund) => {
    const result = match(date, amount);
    expect(result).toMatchObject({ accountId: BOB_MF, fund, month: '2026-09' });
  });

  it('reads Alice’s three the same way', () => {
    // Mirae runs under both people's accounts at the same distance, so this one needs the
    // owner of the debited bank account to break the tie.
    expect(match('2026-09-16', 2500, [], [ALICE_MF])).toMatchObject({ accountId: ALICE_MF, fund: 'Mirae Large & Midcap Fund' });
    expect(match('2026-09-22', 2000)).toMatchObject({ accountId: ALICE_MF, fund: 'Axis Midcap Fund' });
    // Due the 20th, posted the 22nd — and recorded as a fresh contribution instead, which
    // double-counted against the instalment that stayed unclaimed.
    expect(match('2026-09-22', 1000)).toMatchObject({ accountId: ALICE_MF, fund: 'Kotak Emerging Equity Fund' });
  });

  it('honours the amount in effect that month, not today’s', () => {
    // Bandhan ran at ₹3,000 until 2026-06.
    expect(match('2026-05-11', 3000)).toMatchObject({ fund: 'Bandhan Small Cap Fund', month: '2026-05' });
    expect(match('2026-05-11', 10000)).toBeNull();
  });
});

describe('matchSipAcrossAccounts — when it must stay quiet', () => {
  it('refuses an instalment another transfer already claimed', () => {
    expect(match('2026-09-11', 10000, [`${BOB_MF}|Bandhan Small Cap Fund|2026-09`])).toBeNull();
  });

  it('refuses a debit too far from any due date', () => {
    // ₹10,000 on the 25th is neither Bandhan (11th) nor WhiteOak (17th).
    expect(match('2026-09-25', 10000)).toBeNull();
  });

  it('refuses an amount no fund runs at', () => {
    expect(match('2026-09-11', 30000)).toBeNull();
    expect(match('2026-09-11', 25000)).toBeNull();
  });

  it('refuses a stopped fund', () => {
    expect(match('2026-09-15', 0)).toBeNull();
  });

  /*
   * Mirae ₹2,500 on the 15th exists under *both* accounts, at the same distance. With no
   * owner to break the tie it stays a question for a person — a confident wrong account is
   * exactly how ₹30,000 of SIPs reached a Kite wallet.
   */
  it('refuses when two accounts run the same fund on the same day', () => {
    expect(match('2026-09-15', 2500)).toBeNull();
    expect(match('2026-09-15', 2500, [], [BOB_MF])).toMatchObject({ accountId: BOB_MF });
    // A preference that names both accounts breaks nothing.
    expect(match('2026-09-15', 2500, [], [BOB_MF, ALICE_MF])).toBeNull();
  });

  /*
   * ₹5,000 is due twice in Bob's first week — Nippon on the 2nd, Parag Parikh on the
   * 6th — so inside a five-day window both are in range. The nearer due date decides.
   */
  it('lets the nearer due date settle two funds of the same size', () => {
    expect(match('2026-09-02', 5000)).toMatchObject({ fund: 'Nippon India Pharma Fund' });
    expect(match('2026-09-06', 5000)).toMatchObject({ fund: 'Parag Parikh Flexi Cap' });
    // Dead centre between the two, and it says nothing.
    expect(match('2026-09-04', 5000)).toBeNull();
  });

  it('refuses a credit', () => {
    expect(match('2026-09-11', -10000)).toBeNull();
  });
});

describe('findSipInstalments', () => {
  it('finds a mandate that posted in the next month', () => {
    const hits = findSipInstalments({
      date: '2026-10-02',
      amount: 1000,
      funds: [{ name: 'Late Fund', sip_date: '30th', sip_amount: 1000 }],
      claimedSips: new Set(),
    });
    expect(hits).toEqual([{ fund: 'Late Fund', month: '2026-09', amount: 1000, dueDate: '2026-09-30', daysFromDue: 2 }]);
  });

  it('puts the nearest due date first', () => {
    const hits = findSipInstalments({
      date: '2026-09-12',
      amount: 1000,
      funds: [
        { name: 'Far', sip_date: '16th', sip_amount: 1000 },
        { name: 'Near', sip_date: '11th', sip_amount: 1000 },
      ],
      claimedSips: new Set(),
    });
    expect(hits.map((h) => h.fund)).toEqual(['Near', 'Far']);
  });

  it('matches a fund with no due day within its own month only', () => {
    const funds = [{ name: 'Undated', sip_amount: 7000 }];
    expect(findSipInstalments({ date: '2026-09-25', amount: 7000, funds, claimedSips: new Set() })).toHaveLength(1);
    expect(findSipInstalments({ date: '2026-09-25', amount: 7000, funds, claimedSips: new Set(['Undated|2026-09']) })).toHaveLength(0);
  });
});
