import { describe, it, expect } from 'vitest';
import { accountAliases, destinationAccount, matchStatementLines, narrationPayee, readNarration, unalertedDebits } from '../statementNarration';
import type { StatementLine } from '@/lib/statements/accountStatements';
import type { Transfer } from '@/types';

// Narrations shaped like the real HDFC and Kotak statements of June–July 2026; numbers invented.
const accounts = { alice: ['3101', '1202'], bob: ['1303', '1505'] };

describe('readNarration', () => {
  it('settles money to the other person — by name, or by one of their account numbers', () => {
    expect(readNarration('NEFT Dr-KKBK0000123-BOB K-SANDOZ - MUM-HDFCH00012345-NET BANKING SI', 'alice', accounts)).toEqual({
      kind: 'family',
      settle: true,
      counterparty: 'BOB K',
    });
    expect(readNarration('50100333331303 NET BANKING SI -MonthlyValue Dt 01/07/2026', 'alice', accounts)).toMatchObject({ kind: 'family', settle: true });
    expect(readNarration('NEFT HDFCH00012345 ALICE V HDFC0000240 NEFTINW-0011', 'bob', accounts)).toMatchObject({
      kind: 'family',
      settle: true,
      counterparty: 'ALICE V',
    });
  });

  it('never settles money to oneself — "ALICE ₹47,500" was an INDmoney deposit', () => {
    expect(readNarration('UPI-ALICE-alice@okhdfc-FDRL0007001-123-Towar ds US Stocks', 'alice', accounts)).toEqual({
      kind: 'own_account',
      settle: false,
      counterparty: 'ALICE',
    });
  });

  it('does not take a short reference ending in the same digits for an account', () => {
    expect(readNarration('NEFT Dr-UTIB0000001-SOME TRADER-REF 1303', 'alice', accounts)).toMatchObject({ kind: 'other', settle: false });
  });

  it('reads investments, card bills and tax as suggestions only', () => {
    expect(readNarration('ACH D- Indian Clearing Corp-0000ABCDValue Dt 06/07/2026', 'bob', accounts)).toMatchObject({ kind: 'investment', settle: false });
    expect(readNarration('UPI-INDmoney Credit Card-indmoneycc.bdpghdfcbank-HDFC0MERUPI', 'alice', accounts)).toMatchObject({ kind: 'card_bill', settle: false });
    expect(readNarration('UPI-CBDT TIN 2 0-cbdttin@hdfcbank-HDFC0MERUPI', 'alice', accounts)).toMatchObject({ kind: 'tax', settle: false });
  });

  it('borrows a name the same statement gives an account elsewhere', () => {
    const lines = [
      { narration: '50100999991707-TPT-HDFCA1234 B-ZERODHA BROKING LTD-USCNB A/C Value Dt 07/07/2026' },
      { narration: '50100999991707 NET BANKING SI -Investment Value Dt 02/07/2026' },
    ];
    const aliases = accountAliases(lines);
    expect(aliases.get('1707')).toBe('ZERODHA BROKING LTD');
    expect(readNarration(lines[1].narration, 'bob', accounts, aliases)).toMatchObject({
      kind: 'investment',
      settle: false,
      counterparty: 'ZERODHA BROKING LTD',
    });
  });

  it('has nothing to say about a narration that names no one', () => {
    expect(readNarration('IB SS FUNDS TRANSFER DR-12341606 Value Dt 22/07/2026', 'alice', accounts)).toBeNull();
  });
});

describe('narrationPayee', () => {
  it('reads the other party out of each layout', () => {
    expect(narrationPayee('UPI-MS LAKSHMI P-lakshmi@okhdfcbank-SCBL0000001-123-B2 maintenance')).toBe('MS LAKSHMI P');
    expect(narrationPayee('UPI/R IYYAPPAN/HDFC/1234/UPIUPI-136')).toBe('R IYYAPPAN');
    expect(narrationPayee('ACH C- HUL LIMITED-1933044 Value Dt 28/07/2026')).toBe('HUL LIMITED');
  });
});

let seq = 0;
const transfer = (over: Partial<Transfer>): Transfer => ({
  id: `t${++seq}`,
  inbox_item_id: null,
  owner: 'alice',
  date: '2026-10-07',
  amount: 40000,
  direction: 'debit',
  counterparty: null,
  payment_method: 'HDFC Bank account ••3101',
  kind: 'other',
  account_id: null,
  portfolio_investment_id: null,
  credit_card_statement_id: null,
  expense_id: null,
  note: null,
  status: 'needs_review',
  created_at: `2026-10-06T18:${String(40 + seq).padStart(2, '0')}:00Z`,
  updated_at: '2026-10-06T18:40:00Z',
  ...over,
});
const line = (over: Partial<StatementLine>): StatementLine => ({
  date: '2026-10-07',
  narration: 'NEFT Dr-KKBK0000123-BOB K-',
  direction: 'debit',
  amount: 40000,
  balance: 100000,
  ...over,
});

describe('matchStatementLines', () => {
  it('matches by account, direction and amount, each line once, in order', () => {
    const first = transfer({});
    const second = transfer({});
    const lineA = line({ narration: 'to Bob' });
    const lineB = line({ narration: 'to someone', balance: 60000 });
    expect(matchStatementLines([first, second], [{ last4: '3101', lines: [lineA, lineB] }])).toEqual([
      { transfer: first, line: lineA },
      { transfer: second, line: lineB },
    ]);
  });

  it('reads a UPI debit from the same account, and ignores other accounts and cards', () => {
    const upi = transfer({ payment_method: 'HDFC Bank UPI ••3101' });
    const card = transfer({ payment_method: 'HDFC Bank card ••3101' });
    const elsewhere = transfer({ payment_method: 'HDFC Bank account ••1202' });
    const matches = matchStatementLines([upi, card, elsewhere], [{ last4: '3101', lines: [line({}), line({ balance: 1 }), line({ balance: 2 })] }]);
    expect(matches.map((m) => m.transfer)).toEqual([upi]);
  });

  it('allows the statement to post a day or two after the alert, not more', () => {
    expect(matchStatementLines([transfer({ date: '2026-10-06' })], [{ last4: '3101', lines: [line({ date: '2026-10-08' })] }])).toHaveLength(1);
    expect(matchStatementLines([transfer({ date: '2026-10-05' })], [{ last4: '3101', lines: [line({ date: '2026-10-08' })] }])).toEqual([]);
  });

  it('never touches a transfer a person or a rule already decided', () => {
    expect(matchStatementLines([transfer({ status: 'confirmed' })], [{ last4: '3101', lines: [line({})] }])).toEqual([]);
  });
});

describe('destinationAccount', () => {
  it('reads the account a debit went into', () => {
    expect(destinationAccount('50100999991707 NET BANKING SI -Investment')).toBe('1707');
    expect(destinationAccount('50100999991707-TPT-HDFC1234 B-ZERODHA BROKING LTD-')).toBe('1707');
    expect(destinationAccount('IB SS FUNDS TRANSFER DR-12341606 Value Dt 22/07/2026')).toBe('1606');
    expect(destinationAccount('UPI-MS LAKSHMI P-lakshmi@okhdfcbank')).toBeNull();
  });
});

describe('unalertedDebits', () => {
  it('returns the debits no transfer — waiting or confirmed — accounts for', () => {
    const reported = line({ amount: 30000 });
    const silent = line({ amount: 25000, narration: '50100999991707 NET BANKING SI' });
    const credit = line({ direction: 'credit', amount: 5000 });
    const accounts = [{ last4: '3101', lines: [reported, silent, credit] }];
    expect(unalertedDebits([transfer({ amount: 30000, status: 'confirmed' })], accounts)).toEqual([silent]);
  });
});
