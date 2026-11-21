import { describe, it, expect } from 'vitest';
import { classifyTransaction, type ClassifyContext, type StatementRef } from '../classify';
import { findExpenseMatch, type ExpenseCandidate } from '../match';
import { paymentMethodLabel } from '../owners';
import type { InboxTransactionData, TransactionRule } from '@/types';

// Payees below are the real ones from the first live sync (2026-09-14).

const txn = (over: Partial<InboxTransactionData> = {}): InboxTransactionData => ({
  kind: 'transaction',
  bank: 'HDFC Bank',
  amount: 225,
  currency: 'INR',
  direction: 'debit',
  instrument: 'upi',
  last4: '3101',
  merchant: 'ACME ASSOCIATES',
  txnDate: '2026-06-28',
  available: null,
  outcome: 'success',
  international: false,
  ...over,
});

const ctx = (over: Partial<ClassifyContext> = {}): ClassifyContext => ({
  owner: 'alice',
  rules: [],
  statements: [],
  hasExpenseMatch: false,
  ...over,
});

const rule = (over: Partial<TransactionRule> = {}): TransactionRule => ({
  id: 'rule-1',
  owner: null,
  match_counterparty: 'murugesan',
  match_payment_method: null,
  action: 'expense',
  category_id: 'cat-groceries',
  transfer_kind: null,
  account_id: null,
  created_at: '2026-09-14T00:00:00Z',
  ...over,
});

describe('classifyTransaction', () => {
  it('treats an ordinary UPI or card debit as an expense', () => {
    expect(classifyTransaction(txn(), ctx())).toEqual({ kind: 'expense', categoryId: null, ruleId: null });
    expect(classifyTransaction(txn({ merchant: null, instrument: 'card', last4: '2303', bank: 'Axis Bank' }), ctx()).kind).toBe(
      'expense'
    );
  });

  it('ignores declined attempts and foreign-currency spends', () => {
    expect(classifyTransaction(txn({ outcome: 'declined' }), ctx())).toEqual({ kind: 'ignore', reason: 'declined' });
    expect(classifyTransaction(txn({ currency: 'USD', amount: 20 }), ctx())).toEqual({ kind: 'ignore', reason: 'foreign_currency' });
  });

  // Credits used to be dropped outright, so nothing that arrived was ever recorded —
  // including the six INDmoney dividends (migration 035).
  describe('credits', () => {
    const credit = (over: Partial<InboxTransactionData> = {}) => txn({ direction: 'credit', merchant: null, ...over });

    it('records a dividend the mail names outright, without review', () => {
      const data = credit({ bank: 'INDmoney', currency: 'USD', amount: 3.41, instrument: null, merchant: 'Microsoft Inc', purpose: 'dividend' });
      expect(classifyTransaction(data, ctx())).toEqual({
        kind: 'income',
        incomeKind: 'dividend',
        sourceName: 'Microsoft Inc',
        reason: 'Dividend',
      });
    });

    // ₹17,324 and ₹5,995.79 of the live credits are the user's own card bills landing back on
    // the card; as income they would have counted the same money a second time.
    it('ignores a card credit that is a statement payment arriving', () => {
      const statements: StatementRef[] = [
        {
          id: 'st-jun',
          account_id: 'acc-4123',
          statement_date: '2026-06-14',
          statement_amount: 17324,
          amount_paid: 0,
          payment_date: null,
        },
      ];
      const data = credit({ instrument: 'card', last4: '4123', bank: 'ICICI Bank', amount: 17324, txnDate: '2026-06-27' });
      expect(classifyTransaction(data, ctx({ statements }))).toEqual({ kind: 'ignore', reason: 'card_payment_received' });
    });

    it('sends every other credit to review rather than guessing', () => {
      const data = credit({ amount: 85000, instrument: 'upi', txnDate: '2026-08-19' });
      expect(classifyTransaction(data, ctx())).toMatchObject({ kind: 'transfer', suggestedKind: 'other' });
    });

    it('never reads a credit as a spend, however large and unmatched', () => {
      const data = credit({ amount: 180000, instrument: 'account' });
      expect(classifyTransaction(data, ctx()).kind).not.toBe('expense');
    });
  });

  it('marks a card bill paid when the amount equals an open statement shortly after it', () => {
    const statements: StatementRef[] = [
      { id: 'st-aug', account_id: 'acc-1909', statement_date: '2026-08-08', statement_amount: 6968, amount_paid: 0, payment_date: null },
      { id: 'st-old', account_id: 'acc-1909', statement_date: '2026-05-08', statement_amount: 6968, amount_paid: 0, payment_date: null },
    ];
    const data = txn({ merchant: 'Indmoney1', amount: 6968, txnDate: '2026-08-26' });
    expect(classifyTransaction(data, ctx({ statements }))).toEqual({ kind: 'card_bill', statementId: 'st-aug', alreadyPaid: false });
  });

  it('does not match a statement that is already paid, or one dated after the payment', () => {
    const paidLongAgo: StatementRef[] = [
      { id: 'st', account_id: 'a', statement_date: '2026-08-08', statement_amount: 6968, amount_paid: 6968, payment_date: '2026-08-10' },
    ];
    const future: StatementRef[] = [
      { id: 'st', account_id: 'a', statement_date: '2026-09-08', statement_amount: 6968, amount_paid: 0, payment_date: null },
    ];
    const data = txn({ merchant: 'Indmoney1', amount: 6968, txnDate: '2026-08-26' });
    expect(classifyTransaction(data, ctx({ statements: paidLongAgo })).kind).toBe('transfer');
    expect(classifyTransaction(data, ctx({ statements: future })).kind).toBe('transfer');
  });

  // At the first sync every statement had already been marked paid by hand, so
  // the bill payments must link to those rows rather than wait for review.
  it('links a card-bill payment to a statement already marked paid by hand, near its payment date', () => {
    const statements: StatementRef[] = [
      { id: 'st-aug', account_id: 'acc-1909', statement_date: '2026-08-08', statement_amount: 6968, amount_paid: 6968, payment_date: '2026-08-26' },
    ];
    expect(classifyTransaction(txn({ merchant: 'Indmoney1', amount: 6968, txnDate: '2026-08-26' }), ctx({ statements }))).toEqual({
      kind: 'card_bill',
      statementId: 'st-aug',
      alreadyPaid: true,
    });
    // HDFC's own bill-pay handle, against Rewards's September statement marked paid by hand.
    const rewardsCard: StatementRef[] = [
      { id: 'st-sep', account_id: 'acc-5179', statement_date: '2026-09-20', statement_amount: 20826, amount_paid: 20826, payment_date: '2026-10-07' },
    ];
    expect(
      classifyTransaction(txn({ merchant: 'PZ HDFC CC BILLPAY UPI', amount: 20826, txnDate: '2026-10-07', last4: '1303' }), ctx({ owner: 'bob', statements: rewardsCard }))
    ).toEqual({ kind: 'card_bill', statementId: 'st-sep', alreadyPaid: true });
    // Same amount, same day, but not a card-bill payee: a coincidence, not a bill payment.
    expect(classifyTransaction(txn({ merchant: 'Some Grocer', amount: 6968, txnDate: '2026-08-26' }), ctx({ statements })).kind).not.toBe(
      'card_bill'
    );
  });

  it.each([
    ['INDmoney Credit Card Repayment', 30350, 'card_bill'],
    ['Indmoney1', 2530, 'card_bill'],
    ['FINZOOM INVESTMENT ADVISORS PRIVATE LIMITED', 17324, 'investment'],
    ['CBDT TIN 2 0', 100898, 'tax'],
    ['HDFC ATM', 3000, 'cash'],
    ['ALICE', 47500, 'own_account'],
    ['BOB K', 2000, 'family'],
  ])('suggests a transfer for %s', (merchant, amount, suggestedKind) => {
    const result = classifyTransaction(txn({ merchant, amount }), ctx());
    expect(result).toMatchObject({ kind: 'transfer', suggestedKind });
  });

  it('logs merchant-less account debits and large unmatched payments as transfers to review', () => {
    expect(classifyTransaction(txn({ merchant: null, instrument: 'account', amount: 47775 }), ctx())).toMatchObject({
      kind: 'transfer',
      suggestedKind: 'other',
      reason: 'Account transfer (NEFT/IMPS)',
    });
    expect(classifyTransaction(txn({ merchant: 'Some Clinic', amount: 12000 }), ctx())).toMatchObject({
      kind: 'transfer',
      reason: 'Large payment',
    });
  });

  // ₹30,737 at AMAZON PAY ECOM on ICICI ••4123 sat in the transfer queue as "Large payment".
  it('treats a large card debit as a purchase — a card cannot move money between accounts', () => {
    expect(
      classifyTransaction(txn({ merchant: 'AMAZON PAY ECOM', instrument: 'card', last4: '4123', amount: 30737 }), ctx()).kind
    ).toBe('expense');
  });

  // The ₹28,001 gym membership was a large UPI debit — and a real, hand-logged expense.
  it('lets a hand-entered expense win over the size heuristic, but not over a recognised payee', () => {
    expect(classifyTransaction(txn({ merchant: null, amount: 28001 }), ctx({ hasExpenseMatch: true })).kind).toBe('expense');
    expect(classifyTransaction(txn({ merchant: 'CBDT TIN 2 0', amount: 100898 }), ctx({ hasExpenseMatch: true })).kind).toBe(
      'transfer'
    );
  });

  it('applies a saved payee rule before any heuristic', () => {
    expect(classifyTransaction(txn({ merchant: 'MURUGESAN PERIYASAMY' }), ctx({ rules: [rule()] }))).toEqual({
      kind: 'expense',
      categoryId: 'cat-groceries',
      ruleId: 'rule-1',
    });

    const toUsStocks = rule({ match_counterparty: 'alice', action: 'transfer', transfer_kind: 'investment', account_id: 'acc-us' });
    expect(classifyTransaction(txn({ merchant: 'ALICE', amount: 47500 }), ctx({ rules: [toUsStocks] }))).toMatchObject({
      kind: 'transfer',
      suggestedKind: 'investment',
      accountId: 'acc-us',
      ruleId: 'rule-1',
    });

    expect(classifyTransaction(txn({ merchant: 'ACME ASSOCIATES' }), ctx({ rules: [rule({ match_counterparty: 'acme', action: 'ignore' })] }))).toEqual({
      kind: 'ignore',
      reason: 'rule',
    });
  });

  it("respects a rule's owner and payment-method restriction", () => {
    const bobOnly = rule({ owner: 'bob' });
    expect(classifyTransaction(txn({ merchant: 'MURUGESAN PERIYASAMY' }), ctx({ rules: [bobOnly] })).kind).toBe('expense');
    expect(
      classifyTransaction(txn({ merchant: 'MURUGESAN PERIYASAMY' }), ctx({ rules: [rule({ match_payment_method: '••2101' })] }))
    ).toEqual({ kind: 'expense', categoryId: null, ruleId: null });
  });

  // The live June–July rows. FINZOOM is INDmoney's company, and these four debits sat in
  // review as investments; confirming them would have added ₹29,492 of contributions
  // that were really card bills.
  describe('bill payments made through INDmoney', () => {
    const statements: StatementRef[] = [
      { id: 'st-swiggy', account_id: 'acc-1909', statement_date: '2026-06-08', statement_amount: 4963, amount_paid: 4963, payment_date: '2026-06-27' },
      { id: 'st-rupay', account_id: 'acc-2101', statement_date: '2026-06-08', statement_amount: 1999, amount_paid: 1999, payment_date: '2026-06-27' },
      { id: 'st-icici', account_id: 'acc-4123', statement_date: '2026-06-13', statement_amount: 17324, amount_paid: 17324, payment_date: '2026-06-27' },
      // Both Axis statements were marked paid in bulk on 08-15, weeks after the money went.
      { id: 'st-axis-jun', account_id: 'acc-2303', statement_date: '2026-06-17', statement_amount: 5206.24, amount_paid: 5206.24, payment_date: '2026-08-15' },
      { id: 'st-axis-jul', account_id: 'acc-2303', statement_date: '2026-07-17', statement_amount: 5101.68, amount_paid: 5101.68, payment_date: '2026-08-15' },
      { id: 'st-icici-jul', account_id: 'acc-4123', statement_date: '2026-07-13', statement_amount: 5996, amount_paid: 5996, payment_date: '2026-07-27' },
    ];
    const finzoom = 'FINZOOM INVESTMENT ADVISORS PRIVATE LIMITED';

    it.each([
      [4963, 'st-swiggy'],
      [1999, 'st-rupay'],
      [17324, 'st-icici'],
      [5206.24, 'st-axis-jun'],
    ])('links the FINZOOM debit of ₹%s to its card statement rather than calling it an investment', (amount, statementId) => {
      expect(classifyTransaction(txn({ merchant: finzoom, amount, txnDate: '2026-06-27' }), ctx({ statements }))).toEqual({
        kind: 'card_bill',
        statementId,
        alreadyPaid: true,
      });
    });

    it('allows paise of drift, and a bulk paid-on date, for a card-bill payee', () => {
      const repayment = 'INDmoney Credit Card Repayment';
      expect(classifyTransaction(txn({ merchant: repayment, amount: 5995.79, txnDate: '2026-07-27' }), ctx({ statements }))).toMatchObject({
        kind: 'card_bill',
        statementId: 'st-icici-jul',
      });
      expect(classifyTransaction(txn({ merchant: repayment, amount: 5101.68, txnDate: '2026-07-27' }), ctx({ statements }))).toMatchObject({
        kind: 'card_bill',
        statementId: 'st-axis-jul',
      });
    });

    it('keeps amounts exact for any other payee', () => {
      const open: StatementRef[] = [
        { id: 'st', account_id: 'a', statement_date: '2026-08-08', statement_amount: 6968, amount_paid: 0, payment_date: null },
      ];
      expect(classifyTransaction(txn({ merchant: 'Some Grocer', amount: 6968.5, txnDate: '2026-08-26' }), ctx({ statements: open })).kind).not.toBe(
        'card_bill'
      );
    });

    it('still reads FINZOOM as an investment platform when no statement matches', () => {
      expect(classifyTransaction(txn({ merchant: finzoom, amount: 47775, txnDate: '2026-06-27' }), ctx({ statements }))).toMatchObject({
        kind: 'transfer',
        suggestedKind: 'investment',
      });
    });
  });
});

describe('findExpenseMatch', () => {
  const candidate = (over: Partial<ExpenseCandidate> = {}): ExpenseCandidate => ({
    id: 'exp-1',
    date: '2026-06-28',
    amount: 225,
    user_id: 'user-alice',
    created_at: '2026-06-28T10:00:00Z',
    inbox_item_id: null,
    ...over,
  });

  it('matches the same amount within two days either side', () => {
    const t = { amount: 225, txnDate: '2026-06-28' };
    expect(findExpenseMatch(t, [candidate({ date: '2026-06-30' })])?.id).toBe('exp-1');
    expect(findExpenseMatch(t, [candidate({ date: '2026-06-26' })])?.id).toBe('exp-1');
    expect(findExpenseMatch(t, [candidate({ date: '2026-07-01' })])).toBeNull();
    expect(findExpenseMatch(t, [candidate({ amount: 225.5 })])).toBeNull();
  });

  it('skips expenses already linked to an alert or claimed earlier in the same run', () => {
    const t = { amount: 225, txnDate: '2026-06-28' };
    expect(findExpenseMatch(t, [candidate({ inbox_item_id: 'item-9' })])).toBeNull();
    expect(findExpenseMatch(t, [candidate()], { claimed: new Set(['exp-1']) })).toBeNull();
  });

  it("prefers the owner's own expense, then the closest date, then the oldest", () => {
    const t = { amount: 70, txnDate: '2026-07-05' };
    const bobs = candidate({ id: 'bob-same-day', amount: 70, date: '2026-07-05', user_id: 'user-bob' });
    const alices = candidate({ id: 'alice-next-day', amount: 70, date: '2026-07-06', user_id: 'user-alice' });
    expect(findExpenseMatch(t, [bobs, alices], { preferredUserId: 'user-alice' })?.id).toBe('alice-next-day');
    expect(findExpenseMatch(t, [alices, bobs])?.id).toBe('bob-same-day');

    const older = candidate({ id: 'older', amount: 70, date: '2026-07-05', created_at: '2026-07-05T08:00:00Z' });
    const newer = candidate({ id: 'newer', amount: 70, date: '2026-07-05', created_at: '2026-07-05T09:00:00Z' });
    expect(findExpenseMatch(t, [newer, older])?.id).toBe('older');
  });
});

describe('paymentMethodLabel', () => {
  it('names the bank, rail and card or account', () => {
    expect(paymentMethodLabel({ bank: 'HDFC Bank', instrument: 'upi', last4: '3101' })).toBe('HDFC Bank UPI ••3101');
    expect(paymentMethodLabel({ bank: 'Axis Bank', instrument: 'card', last4: null })).toBe('Axis Bank card');
  });
});
