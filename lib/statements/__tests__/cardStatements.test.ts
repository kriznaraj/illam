import { describe, it, expect } from 'vitest';
import { parseAxisCardStatement, parseHdfcCardStatement, parseIciciCardStatement } from '../cardStatements';

/*
 * Layouts copied from the real HDFC and Axis statements captured on 2026-09-14,
 * as pdf.js extracts them — glued cells and HDFC's rupee glyph rendered as "C"
 * included. Names, addresses, amounts and card digits are invented.
 */

const HDFC = `TOTAL AMOUNT DUE
C31,861.08
MINIMUM DUE
C1,600.00
DUE DATE
28 Jul, 2026
Reward Points
4,036
Domestic Transactions
DATE & TIMETRANSACTION DESCRIPTIONAMOUNTPI
TEST HOLDER
27/06/2026| 02:23BPPY CC PAYMENT AS••2348lMMwZ (Ref# ST••4527)+  C 4,963.17
l
05/07/2026| 12:04RAZ*SwiggyBangalore C 442.87
l
07/07/2026| 00:0010% Swiggy CashBack+  C 45.60
Page 1 of 2
Swiggy HDFC Bank Credit Card Statement
TEST HOLDER
Credit Card No.
Alternate Account Number
Statement Date
Billing Period
CKYC ID
526873XXXXXX9999
••1111
08 Jul, 2026
09 Jun, 2026 - 08 Jul, 2026
To update personal details : Change of Address: click here`;

const AXIS = `Test Holder
PAYMENT SUMMARY
Total Payment DueMinimum Payment Due Statement PeriodPayment Due DateStatement Generation Date
09/05/2026 - 15/06/202605/07/202615/06/2026
5,206.24   Dr104.00   Dr
Credit Card NumberCredit LimitAvailable Credit LimitAvailable Cash Limit
635876******9999500,000.00494,793.7650,000.00
DATETRANSACTION DETAILSMERCHANT CATEGORYAMOUNT (Rs.)CASHBACK EARNED
16/05/2026UPI/TEST ENTERPRISE/Q••1001@YBL/••1002@SRESTAURANTS63.00 Dr0.00 Cr
20/05/2026GST ON FUEL SURCHARGE                           5.67 Dr0.00 Cr
20/05/2026FUEL CASHBACK REBATES                           31.52 Cr0.00 Dr
20/05/2026UPI/PUMP 6 TEST AGENCY/Q••1003@YBL/101FUEL3,152.40 Dr0.00 Cr
**** End of Statement ****`;

describe('parseHdfcCardStatement', () => {
  it('reads the dues, dates and card from the real layout', () => {
    expect(parseHdfcCardStatement(HDFC)).toMatchObject({
      bank: 'HDFC Bank',
      last4: '9999',
      statementDate: '2026-07-08',
      periodStart: '2026-06-09',
      periodEnd: '2026-07-08',
      dueDate: '2026-07-28',
      totalDue: 31861.08,
      minDue: 1600,
    });
  });

  it('reads transactions, telling payments and cashback ("+") from spends', () => {
    expect(parseHdfcCardStatement(HDFC).transactions).toEqual([
      { date: '2026-06-27', description: 'BPPY CC PAYMENT AS••2348lMMwZ (Ref# ST••4527)', amount: 4963.17, direction: 'credit' },
      { date: '2026-07-05', description: 'RAZ*SwiggyBangalore', amount: 442.87, direction: 'debit' },
      { date: '2026-07-07', description: '10% Swiggy CashBack', amount: 45.6, direction: 'credit' },
    ]);
  });

  it('returns nulls, not guesses, for text that is not an HDFC statement', () => {
    expect(parseHdfcCardStatement('nothing useful here')).toEqual({
      bank: 'HDFC Bank',
      last4: null,
      statementDate: null,
      periodStart: null,
      periodEnd: null,
      dueDate: null,
      totalDue: null,
      minDue: null,
      transactions: [],
    });
  });
});

describe('parseAxisCardStatement', () => {
  it('reads the payment summary glued onto single lines', () => {
    expect(parseAxisCardStatement(AXIS)).toMatchObject({
      bank: 'Axis Bank',
      last4: '9999',
      periodStart: '2026-05-09',
      periodEnd: '2026-06-15',
      dueDate: '2026-07-05',
      statementDate: '2026-06-15',
      totalDue: 5206.24,
      minDue: 104,
    });
  });

  it('reads transactions with their Dr/Cr direction', () => {
    const { transactions } = parseAxisCardStatement(AXIS);
    expect(transactions).toHaveLength(4);
    expect(transactions[0]).toMatchObject({ date: '2026-05-16', amount: 63, direction: 'debit' });
    expect(transactions[2]).toMatchObject({ description: 'FUEL CASHBACK REBATES', amount: 31.52, direction: 'credit' });
    expect(transactions[3]).toMatchObject({ amount: 3152.4, direction: 'debit' });
  });

  it('treats a credit balance as nothing due', () => {
    const credit = AXIS.replace('5,206.24   Dr104.00   Dr', '127.88   Cr0.00   Cr');
    expect(parseAxisCardStatement(credit)).toMatchObject({ totalDue: 0, minDue: 0 });
  });
});

// Layout of the real ICICI Amazon Pay statement captured 2026-09-14; card digits and names invented.
const ICICI = `PAYMENT DUE DATE
STATEMENT DATE
STATEMENT SUMMARY
Total  Amount  due
Minimum Amount due
EARNINGS
281281
 Others-100%
100%
\`304.59
\`5,995.79
SPENDS OVERVIEW
July 12, 2026
July 30, 2026
DateSerNo.Transaction DetailsReward
4315XXXXXXXX9999
Credit Limit (Including cash)Available Credit (Including cash)Cash LimitAvailable Cash
\`3,00,000.00\`2,94,004.21\`30,000.00\`30,000.00
Statement period : June 13, 2026 to July 12, 2026
Previous BalancePurchases / ChargesCash AdvancesPayments / Credits
\`17,324.24\`5,995.79\`0.00
\`17,324.24`;

describe('parseIciciCardStatement', () => {
  it('reads the dues, dates and card, with the backtick rupee glyph', () => {
    expect(parseIciciCardStatement(ICICI)).toEqual({
      bank: 'ICICI Bank',
      last4: '9999',
      statementDate: '2026-07-12',
      periodStart: '2026-06-13',
      periodEnd: '2026-07-12',
      dueDate: '2026-07-30',
      totalDue: 5995.79,
      minDue: 304.59,
      transactions: [],
    });
  });

  it('returns nulls, not guesses, for text that is not an ICICI statement', () => {
    expect(parseIciciCardStatement('nothing useful here')).toMatchObject({ last4: null, statementDate: null, dueDate: null, totalDue: null });
  });
});
