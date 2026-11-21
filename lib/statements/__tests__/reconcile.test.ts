import { describe, it, expect } from 'vitest';
import {
  findLineAlert,
  matchStatementLine,
  statementDescription,
  statementMerchant,
  type LineAlert,
  type ReconcileExpense,
} from '../reconcile';

// Descriptions shaped like the real Axis and HDFC statement lines of 2026-07; handles and digits invented.
describe('statementMerchant', () => {
  it.each([
    ['UPI/APOLLO PHARMACY/APOLLOPHARMACYTNPL@Y', 'APOLLO PHARMACY'],
    ['UPI/VELMURUGAN  NATARAJAN/Q12340000@YBL/8', 'VELMURUGAN NATARAJAN'],
    ['UPI-Sample Food CourtSREE FO', 'Sample Food CourtSREE FO'],
    ['RAZ*SwiggyBangalore', 'RAZ*SwiggyBangalore'],
    ['CC-UPI FUEL SURCHARGE RUPAY CARD', 'CC-UPI FUEL SURCHARGE RUPAY CARD'],
  ])('%s → %s', (description, merchant) => {
    expect(statementMerchant(description)).toBe(merchant);
  });
});

describe('statementDescription', () => {
  it('drops UPI handles and masks long digit runs before storing', () => {
    expect(statementDescription('UPI/ESWARAN/Q12341111@YBL/123456780001@SUPE')).toBe('UPI/ESWARAN/[upi]/[upi]');
    expect(statementDescription('EMI 1234567890123 PRINCIPAL')).toBe('EMI ••0123 PRINCIPAL');
  });
});

const expense = (over: Partial<ReconcileExpense>): ReconcileExpense => ({
  id: 'e',
  date: '2026-07-06',
  amount: 500,
  user_id: 'u',
  created_at: '2026-07-06T10:00:00Z',
  inbox_item_id: null,
  merchant: null,
  payment_method: null,
  description: 'Groceries',
  source: 'manual',
  needs_review: false,
  ...over,
});

describe('matchStatementLine', () => {
  const alertOfThisCard = new Map([
    ['alert-axis', true],
    ['alert-upi-3101', false],
  ]);

  it("never takes an expense tied to another card's or account's alert", () => {
    const expenses = [expense({ id: 'upi', inbox_item_id: 'alert-upi-3101' }), expense({ id: 'manual', date: '2026-07-08' })];
    expect(matchStatementLine({ date: '2026-07-06', amount: 500 }, expenses, { claimed: new Set(), alertOfThisCard })?.id).toBe('manual');
  });

  it("prefers the expense tied to this card's alert, then the closest date", () => {
    const expenses = [expense({ id: 'near' }), expense({ id: 'axis', date: '2026-07-08', inbox_item_id: 'alert-axis' })];
    expect(matchStatementLine({ date: '2026-07-06', amount: 500 }, expenses, { claimed: new Set(), alertOfThisCard })?.id).toBe('axis');
  });

  it('skips claimed expenses, other amounts and dates outside the window', () => {
    const expenses = [expense({ id: 'claimed' }), expense({ id: 'other-amount', amount: 501 }), expense({ id: 'far', date: '2026-07-10' })];
    expect(matchStatementLine({ date: '2026-07-06', amount: 500 }, expenses, { claimed: new Set(['claimed']), alertOfThisCard })).toBeNull();
  });
});

describe('findLineAlert', () => {
  const alert = (over: Partial<LineAlert>): LineAlert => ({
    id: 'a',
    date: '2026-07-14',
    amount: 156.92,
    ofThisCard: true,
    linkedExpenseId: null,
    consumedAction: null,
    ...over,
  });

  it("finds this card's unlinked alert for the line", () => {
    const alerts = [alert({ id: 'other-card', ofThisCard: false }), alert({ id: 'linked', linkedExpenseId: 'e1' }), alert({ id: 'this', date: '2026-07-13' })];
    expect(findLineAlert({ date: '2026-07-14', amount: 156.92 }, alerts, new Set())?.id).toBe('this');
    expect(findLineAlert({ date: '2026-07-14', amount: 156.92 }, alerts, new Set(['this']))).toBeNull();
  });
});
