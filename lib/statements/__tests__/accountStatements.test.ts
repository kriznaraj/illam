import { describe, it, expect } from 'vitest';
import { parseHdfcAccountStatement, parseKotakAccountStatement, splitGluedAmounts } from '../accountStatements';

/*
 * Layouts copied from the real HDFC (combined, two accounts) and Kotak statements
 * captured on 2026-09-14, as pdf.js extracts them. Names, account numbers and
 * amounts are invented; each account's arithmetic is kept exact because the
 * reader trusts nothing else.
 */

const hdfcPageHeader = (account: string, type: string) => `Alice V

Customer ID

Account Number

Account Type

Statement From

Savings Account Details

Opening Balance

: 12345678

: ${account}

: 01/07/2026 To 31/07/2026

: INR

: HDFC0000002

: 1,00,000.00

: ${type}
`;

const hdfcSummary = (closing: string, credits: string, debits: string, opening: string) => `Total Withdrawal Balance***

1

25

Credit Count

Debit Count

${closing}

${credits}

${debits}

${opening}

Closing Balance

Credit Amount

Debit Amount

Opening Balance

SUMMARY

Page 3 of 5
`;

const HDFC = `Statement as on

Account Relationship Summary

: 31/07/2026

INRSAVINGS ACCOUNTS260500.00CR0.000.000.00260500.00

Page 1 of 5
${hdfcPageHeader('50100111113101', 'INSTANT SAVING SALARY PREMIUM \n(161)')}
Txn DateNarrationWithdrawalsDepositsClosing Balance
01/07/202650100333331303 NET BANKING SI
-MonthlyValue Dt 01/07/2026
25,000.000.0075,000.00
07/07/2026NEFT Dr-KKBK0000123-BOB
K-SANDOZ -
MUM-HDFCH00012345-NET BANKING
07/07/2026 Ref HDFCH00012345
42,000.000.0033,000.00
09/07/2026UPI-TEST STORES-Q••1004@YBL-YESB0YBLUPI-600000000001-UPI
3,000.000.0030,000.00
Page 2 of 5
${hdfcPageHeader('50100111113101', 'INSTANT SAVING SALARY PREMIUM \n(161)')}
30/07/2026ACME Salary July 26 Value Dt 30/07/2026
0.002,10,000.002,40,000.00
${hdfcSummary('2,40,000.00', '2,10,000.00', '70,000.00', '1,00,000.00')}
${hdfcPageHeader('50100222221202', 'SAVINGS A/C - RESIDENT (100)')}
Txn DateNarrationWithdrawalsDepositsClosing Balance
28/07/2026ACH C- DIVIDEND Value Dt 28/07/2026
0.00500.0020,500.00
${hdfcSummary('20,500.00', '500.00', '0.00', '20,000.00')}
*** End of Statement ***
`;

const kotak = (total: string) => `Account Statement
01 Jul 2026 - 31 Jul 2026
K Bob
CRN xxxxxx795
MICR 600000000   IFSC Code KKBK0000123
Account No. 7311111505
Account Type  Savings
#DateDescriptionChq/Ref. No.Withdrawal (Dr.)Deposit (Cr.)Balance
--Opening Balance---40,000.00
101 Jul 2026UPI/SOMEONE/YESB/UPIUPI-1231,000.0039,000.00
Statement Generated on 01 Aug 2026, 15:59Page 1 of 5
End of Statement
Account Summary
   ParticularsOpening BalanceClosing Balance
   Savings Account (SA):40,000.0039,000.00
   ActivMoney (AM):1,35,000.001,47,000.00
   Total Balance (SA + AM):${total}
For assistance, reach out to us at:
`;

describe('splitGluedAmounts', () => {
  it('splits two glued amounts where the first one\'s decimals end', () => {
    expect(splitGluedAmounts('48,615.2750,390.74')).toEqual([48615.27, 50390.74]);
    expect(splitGluedAmounts('1,35,000.001,47,000.00')).toEqual([135000, 147000]);
  });

  it('refuses a run that does not split into properly grouped amounts', () => {
    expect(splitGluedAmounts('49957.5')).toBeNull();
  });
});

describe('parseHdfcAccountStatement', () => {
  it('reads one closing balance per account of a combined statement', () => {
    const parsed = parseHdfcAccountStatement(HDFC);
    expect(parsed.periodFrom).toBe('2026-07-01');
    expect(parsed.periodTo).toBe('2026-07-31');
    expect(parsed.accounts).toMatchObject([
      {
        last4: '3101',
        accountType: 'INSTANT SAVING SALARY PREMIUM',
        opening: 100000,
        credits: 210000,
        debits: 70000,
        closing: 240000,
        reconciled: true,
        linesReconciled: true,
      },
      {
        last4: '1202',
        accountType: 'SAVINGS A/C - RESIDENT',
        opening: 20000,
        credits: 500,
        debits: 0,
        closing: 20500,
        reconciled: true,
        linesReconciled: true,
      },
    ]);
  });

  it('reads each transaction line, across page breaks, with the narration that names the other side', () => {
    const [salary] = parseHdfcAccountStatement(HDFC).accounts;
    expect(salary.lines).toEqual([
      { date: '2026-07-01', narration: '50100333331303 NET BANKING SI -MonthlyValue Dt 01/07/2026', direction: 'debit', amount: 25000, balance: 75000 },
      {
        date: '2026-07-07',
        // The wrapped "07/07/2026 Ref …" inside the row is not a new row.
        narration: 'NEFT Dr-KKBK0000123-BOB K-SANDOZ - MUM-HDFCH00012345-NET BANKING 07/07/2026 Ref HDFCH00012345',
        direction: 'debit',
        amount: 42000,
        balance: 33000,
      },
      { date: '2026-07-09', narration: 'UPI-TEST STORES-Q••1004@YBL-YESB0YBLUPI-600000000001-UPI', direction: 'debit', amount: 3000, balance: 30000 },
      { date: '2026-07-30', narration: 'ACME Salary July 26 Value Dt 30/07/2026', direction: 'credit', amount: 210000, balance: 240000 },
    ]);
  });

  it('does not trust lines whose running balance breaks', () => {
    const [salary] = parseHdfcAccountStatement(HDFC.replace('42,000.000.0033,000.00', '42,000.000.0034,000.00')).accounts;
    expect(salary.linesReconciled).toBe(false);
  });

  it('reads masked account numbers the same way', () => {
    const parsed = parseHdfcAccountStatement(HDFC.replace(/5010011111/g, '••'));
    expect(parsed.accounts[0].last4).toBe('3101');
  });

  it('marks an account whose summary does not add up as not reconciled', () => {
    const parsed = parseHdfcAccountStatement(HDFC.replace('2,40,000.00\n\n2,10,000.00', '2,41,000.00\n\n2,10,000.00'));
    expect(parsed.accounts[0].reconciled).toBe(false);
    expect(parsed.accounts[1].reconciled).toBe(true);
  });
});

describe('parseKotakAccountStatement', () => {
  it('reads savings plus ActivMoney as the account balance', () => {
    const parsed = parseKotakAccountStatement(kotak('1,75,000.001,86,000.00'));
    expect(parsed.periodTo).toBe('2026-07-31');
    expect(parsed.accounts).toMatchObject([
      {
        last4: '1505',
        accountType: 'Savings + ActivMoney',
        opening: 175000,
        credits: null,
        debits: null,
        closing: 186000,
        reconciled: true,
        linesReconciled: true,
      },
    ]);
    // The reference, amount and balance arrive glued; the running balance decides the cut.
    expect(parsed.accounts[0].lines).toEqual([
      { date: '2026-07-01', narration: 'UPI/SOMEONE/YESB/UPIUPI-123', direction: 'debit', amount: 1000, balance: 39000 },
    ]);
  });

  it('is not reconciled when the parts do not make the printed total', () => {
    const parsed = parseKotakAccountStatement(kotak('1,75,000.001,85,000.00'));
    expect(parsed.accounts[0].reconciled).toBe(false);
  });
});
