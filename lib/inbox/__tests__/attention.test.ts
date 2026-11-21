import { describe, it, expect } from 'vitest';
import { evaluateAttention, LARGE_DEBIT_THRESHOLD } from '../attention';
import type { InboxCardStatementData, InboxTransactionData } from '@/types';

const TODAY = '2026-09-14';

const txn = (over: Partial<InboxTransactionData> = {}): InboxTransactionData => ({
  kind: 'transaction',
  bank: 'HDFC Bank',
  amount: 500,
  currency: 'INR',
  direction: 'debit',
  instrument: 'card',
  last4: '1234',
  merchant: 'SWIGGY',
  txnDate: TODAY,
  available: null,
  outcome: 'success',
  international: false,
  ...over,
});

const statement = (over: Partial<InboxCardStatementData> = {}): InboxCardStatementData => ({
  kind: 'card_statement',
  bank: 'HDFC Bank',
  last4: '1234',
  statementDate: '2026-09-03',
  totalDue: 23456,
  minDue: 1180,
  dueDate: '2026-09-23',
  passwordProtected: true,
  ...over,
});

describe('card statements', () => {
  it('flags a bill until its due date, however old the email', () => {
    expect(evaluateAttention(statement(), '2026-09-03', TODAY)).toEqual({
      needsAttention: true,
      reason: 'Card bill due',
      actionBy: '2026-09-23',
    });
  });

  it('keeps an overdue bill flagged for a week, then lets it go', () => {
    expect(evaluateAttention(statement({ dueDate: '2026-09-07' }), '2026-08-20', TODAY).needsAttention).toBe(true);
    expect(evaluateAttention(statement({ dueDate: '2026-09-06' }), '2026-08-20', TODAY).needsAttention).toBe(false);
  });

  it('flags a fresh statement with no readable due date, but not a backfilled one', () => {
    const unreadable = statement({ dueDate: null, totalDue: null });
    expect(evaluateAttention(unreadable, TODAY, TODAY)).toEqual({
      needsAttention: true,
      reason: 'New card statement',
      actionBy: null,
    });
    expect(evaluateAttention(unreadable, '2026-08-01', TODAY).needsAttention).toBe(false);
  });
});

describe('transactions', () => {
  it('flags a large debit at the threshold, not below it', () => {
    expect(evaluateAttention(txn({ amount: LARGE_DEBIT_THRESHOLD }), TODAY, TODAY).reason).toBe('Large debit');
    expect(evaluateAttention(txn({ amount: LARGE_DEBIT_THRESHOLD - 0.01 }), TODAY, TODAY).needsAttention).toBe(false);
  });

  it('never flags money coming in', () => {
    expect(evaluateAttention(txn({ amount: 50_000, direction: 'credit' }), TODAY, TODAY).needsAttention).toBe(false);
  });

  it('flags declined and international transactions regardless of size', () => {
    expect(evaluateAttention(txn({ outcome: 'declined' }), TODAY, TODAY).reason).toBe('Transaction declined');
    expect(evaluateAttention(txn({ currency: 'USD', amount: 20, international: true }), TODAY, TODAY).reason).toBe(
      'International transaction'
    );
  });

  // The first sync backfills 90 days; none of that should land as "needs attention".
  it('does not flag transactions older than a week', () => {
    expect(evaluateAttention(txn({ amount: 90_000 }), '2026-09-07', TODAY).needsAttention).toBe(true);
    expect(evaluateAttention(txn({ amount: 90_000 }), '2026-09-06', TODAY).needsAttention).toBe(false);
  });
});

describe('other kinds', () => {
  it('flags a fresh investment statement to review', () => {
    const data = {
      kind: 'investment_statement' as const,
      provider: 'cdsl' as const,
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      amount: null,
      hasAttachment: true,
    };
    expect(evaluateAttention(data, TODAY, TODAY).reason).toBe('New statement to review');
    expect(evaluateAttention(data, '2026-08-01', TODAY).needsAttention).toBe(false);
  });

  it('flags notices only when they carry action keywords', () => {
    const notice = { kind: 'notice' as const, institution: 'HDFC Bank', amount: null };
    expect(evaluateAttention({ ...notice, keywords: ['KYC', 'Action required'] }, TODAY, TODAY).reason).toBe(
      'KYC, Action required'
    );
    expect(evaluateAttention({ ...notice, keywords: [] }, TODAY, TODAY).needsAttention).toBe(false);
  });

  it('never flags a trade confirmation', () => {
    const trade = {
      kind: 'trade' as const,
      broker: 'INDmoney',
      side: 'buy' as const,
      symbol: 'Microsoft Inc. Class A',
      quantity: null,
      price: null,
      amount: 161.37,
      currency: 'USD',
      outcome: 'success' as const,
    };
    expect(evaluateAttention(trade, TODAY, TODAY).needsAttention).toBe(false);
  });
});
