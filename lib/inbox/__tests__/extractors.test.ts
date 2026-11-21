import { describe, it, expect } from 'vitest';
import { extractMessage, type ExtractorInput } from '../extractors';
import { INBOX_SOURCES, type InboxSourceId } from '../sources';

/*
 * These messages are SYNTHETIC — modelled on the published shapes of HDFC,
 * Axis, CDSL, NPS and INDmoney mail, not copied from real inboxes. Replace them
 * with redacted real samples (tmp/emails/*.eml) as those become available; the
 * expectations should survive the swap, and where they don't, the extractor is
 * what needs fixing.
 */

const source = (id: InboxSourceId) => {
  const found = INBOX_SOURCES.find((s) => s.id === id);
  if (!found) throw new Error(`no source ${id}`);
  return found;
};

const input = (subject: string, body: string, attachmentNames: string[] = []): ExtractorInput => ({
  subject,
  body,
  receivedDate: '2026-09-12',
  attachmentNames,
});

describe('bank alerts', () => {
  // Live: every HDFC NEFT/IMPS debit was filed under the payee "all times. If you have not
  // done above transaction, please i…" — "at (.+?) on \d" had reached into the safety
  // footer. A name, not a sentence: with nothing better to read, the payee is dropped.
  /*
   * Axis sends this layout as well as the prose one, and the prose patterns read nothing in it:
   * 31 of 46 live Axis alerts had no payee, were described "Axis Bank card ••2303 payment", and
   * so had nothing for the category matcher — every one landed in Miscellaneous.
   */
  it('reads a payee, time and card from a two-column Axis alert', () => {
    const result = extractMessage(
      source('axis_alerts'),
      input(
        'Transaction alert on Axis Bank Credit Card',
        `Dear Cardholder,

Thank you for using your Axis Bank Credit Card. A transaction has been charged to your card.

Transaction Amount:
INR 289
Merchant Name:
SRI SWEETS
Axis Bank Credit Card No.:
XX0001
Date & Time:
19-09-2026, 13:20:46 IST
Available Limit*:
INR 457892
Total Credit Limit*:
INR 500000

*The information above includes the available and total credit limit across all of your Axis Bank credit cards.`
      )
    );

    expect(result.title).toBe('SRI SWEETS');
    expect(result.data).toMatchObject({
      kind: 'transaction',
      amount: 289,
      currency: 'INR',
      direction: 'debit',
      merchant: 'SRI SWEETS',
      last4: '0001',
      txnDate: '2026-09-19',
      txnTime: '13:20:46',
      // "Total Credit Limit" must not be read as the balance.
      available: 457892,
    });
  });

  it('prefers a labelled payee over anything a sentence implies', () => {
    const result = extractMessage(
      source('axis_alerts'),
      input(
        'Transaction alert',
        `Thank you for using your card at all times. A transaction has been charged.
Merchant Name:
SRI SWEETS
Transaction Amount:
INR 289`
      )
    );
    expect(result.data).toMatchObject({ merchant: 'SRI SWEETS' });
  });

  it('does not read a safety footer as the payee', () => {
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        'Alert : Account update',
        `Dear Customer,

Rs.10000.00 has been debited from your account ending 1303 on 17-09-26.

Please keep your contact details updated at all times. If you have not done above transaction, please immediately call on 18002586161 to report.`
      )
    );
    expect(result.data).toMatchObject({ kind: 'transaction', amount: 10000, direction: 'debit', merchant: null });
    expect(result.title).toBe('Payment');
  });

  it('still reads a real payee from an "at MERCHANT on DATE" card alert', () => {
    const result = extractMessage(
      source('axis_alerts'),
      input(
        'Transaction alert',
        `INR 660.78 spent on Axis Bank Card XX0001 at MEGHA RESTAURANTS on 14-09-26.

Please do not share your OTP with anyone. If you have not done above transaction, please call on 18604195555.`
      )
    );
    expect(result.data).toMatchObject({ merchant: 'MEGHA RESTAURANTS', amount: 660.78 });
  });

  it('reads an HDFC credit-card debit', () => {
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        'Alert : Update on your HDFC Bank Credit Card',
        `Dear Card Member,

Rs.2,477.14 is debited from your HDFC Bank Credit Card ending 1234 towards AMAZON PAY INDIA on 12 Sep, 2026 at 20:15:10.

If you did not authorize this transaction, please report it immediately by calling 18002586161 or SMS BLOCK 1234 to 7308080808.

Never share your OTP, card number or CVV with anyone.`
      )
    );

    expect(result.kind).toBe('transaction');
    expect(result.title).toBe('AMAZON PAY INDIA');
    expect(result.summary).toBe('Debit · HDFC Bank card ••1234');
    expect(result.data).toMatchObject({
      amount: 2477.14,
      currency: 'INR',
      direction: 'debit',
      instrument: 'card',
      last4: '1234',
      merchant: 'AMAZON PAY INDIA',
      txnDate: '2026-09-12',
      outcome: 'success',
      international: false,
    });
  });

  it('reads an HDFC UPI debit, taking the payee name after the VPA', () => {
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        'You have done a UPI txn. Check details!',
        'Dear Customer, Rs.500.00 has been debited from account **4321 to VPA swiggy.stores@icici SWIGGY on 12-09-26. Your UPI transaction reference number is 123456789012.'
      )
    );

    expect(result.data).toMatchObject({
      kind: 'transaction',
      amount: 500,
      direction: 'debit',
      instrument: 'upi',
      last4: '4321',
      merchant: 'SWIGGY',
      txnDate: '2026-09-12',
    });
  });

  it('reads a UPI credit', () => {
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        'You have received money',
        'Dear Customer, Rs. 1,500.00 is successfully credited to your account **4321 by VPA friend@okaxis on 13-09-26. Your UPI transaction reference number is 123456789013.'
      )
    );

    expect(result.data).toMatchObject({ amount: 1500, direction: 'credit', merchant: 'friend@okaxis', txnDate: '2026-09-13' });
    expect(result.summary).toMatch(/^Credit/);
  });

  it('reads an Axis card spend with its available limit', () => {
    const result = extractMessage(
      source('axis_alerts'),
      input(
        'Transaction alert on Axis Bank Credit Card no. XX5678',
        'Dear Customer, Thank you for using your card no. XX5678 for INR 1,234.50 at ZOMATO on 12-09-26 14:02:11 IST. Available Limit: INR 88,765.50. If this transaction was not initiated by you, SMS BLOCK 5678 to +919951860002.'
      )
    );

    expect(result.data).toMatchObject({
      amount: 1234.5,
      direction: 'debit',
      instrument: 'card',
      last4: '5678',
      merchant: 'ZOMATO',
      available: 88765.5,
    });
  });

  it('marks a foreign-currency spend international and keeps its currency', () => {
    const result = extractMessage(
      source('axis_alerts'),
      input(
        'Transaction alert',
        'Transaction alert: USD 20.00 spent on Axis Bank Credit Card no. XX5678 at OPENAI *CHATGPT SUBSCR on 10-09-26 03:12:45 IST. Available Limit: INR 80,000.00.'
      )
    );

    expect(result.data).toMatchObject({ amount: 20, currency: 'USD', international: true, merchant: 'OPENAI *CHATGPT SUBSCR' });
  });

  it('marks a declined transaction', () => {
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        'Transaction declined',
        'Dear Card Member, your transaction of Rs.42,000.00 on HDFC Bank Credit Card ending 1234 at CROMA RETAIL on 11-09-2026 has been declined due to insufficient credit limit.'
      )
    );

    expect(result.data).toMatchObject({ amount: 42000, direction: 'debit', outcome: 'declined', merchant: 'CROMA RETAIL' });
    expect(result.summary).toContain('Declined');
  });

  // Regressions from the first live sync: "info" matched inside "information" and
  // "inform", turning footers into merchants; a footer mention of international
  // usage flagged domestic UPI; a declined attempt with no debit verb became a notice.
  it('does not take a merchant from "information"/"inform you" or a footer', () => {
    const result = extractMessage(
      source('axis_alerts'),
      input(
        'Transaction alert',
        'INR 795.18 spent using your Axis Bank Credit Card no. XX0001. The information above includes the available and total credit limit. To enable international usage, visit the app.'
      )
    );
    expect(result.data).toMatchObject({ amount: 795.18, last4: '0001', merchant: null, international: false });
  });

  it('reads a declined attempt as a declined transaction, not a notice', () => {
    const result = extractMessage(
      source('axis_alerts'),
      input(
        'Transaction on Axis Bank Credit Card Declined',
        'We would like to inform you that your transaction attempt for INR 28,000.88 on Axis Bank Credit Card no. XX0001 has been declined.'
      )
    );
    expect(result.kind).toBe('transaction');
    expect(result.data).toMatchObject({ amount: 28000.88, direction: 'debit', outcome: 'declined', merchant: null });
  });

  it('shows the payee name rather than the UPI handle', () => {
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        'You have done a UPI txn',
        'Rs.1000.00 has been debited from account 3101 to VPA dadadaniel443@okhdfcbank (Daniel Ramaiya) on 23-06-26.'
      )
    );
    expect(result.title).toBe('Daniel Ramaiya');
    expect(JSON.stringify(result.data)).not.toContain('okhdfcbank');
  });

  it('turns an alert with no debit or credit into a notice', () => {
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        'Your HDFC Bank Credit Card limit has been enhanced',
        'Dear Card Member, the credit limit on your card ending 1234 has been increased to Rs. 3,00,000.'
      )
    );

    expect(result.kind).toBe('notice');
    expect(result.title).toBe('Your HDFC Bank Credit Card limit has been enhanced');
    expect(result.data).toMatchObject({ kind: 'notice', amount: 300000, keywords: [] });
  });

  it('flags notices that ask for action', () => {
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        'Action required: Complete your KYC',
        'Dear Customer, please complete your re-KYC by 30 Sep 2026 to continue using your account without interruption.'
      )
    );

    expect(result.kind).toBe('notice');
    expect(result.data).toMatchObject({ keywords: ['KYC', 'Action required'] });
    expect(result.summary).toContain('re-KYC');
  });

  // The live templates below are from dumpSamples (2026-10-18), masked by the Apps Script and
  // with tracking links removed. HDFC's plain-text card alert wraps every value in `*` (bold), which
  // broke each shape: 9 card alerts since September were stored with no payee, card or time.
  it('reads the live HDFC card alert, bold markers and all', () => {
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        'A payment was made using your Credit Card',
        `Dear Customer,

Greetings from HDFC Bank.

We would like to inform you that *Rs. 200.00* has been debited from your
HDFC Bank Credit Card ending *1909* towards *RSP*BHARTI AIRTEL LIMI* on *17
Oct, 2026 at 16:50:04*.
To check your available balance, outstanding amount, or view recent
transactions, you may use:

   - *Mycards:*https://mycards.hdfc.bank.in

*Important Note:*
If you did not authorise this transaction, please act immediately.`
      )
    );
    expect(result.title).toBe('BHARTI AIRTEL LIMI');
    expect(result.data).toMatchObject({
      amount: 200,
      direction: 'debit',
      instrument: 'card',
      last4: '1909',
      merchant: 'BHARTI AIRTEL LIMI',
      txnDate: '2026-10-17',
      txnTime: '16:50:04',
    });
  });

  it('reads the live HDFC account UPI alert, payee from the brackets', () => {
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        '❗  You have done a UPI txn. Check details!',
        `Dear Customer,

Greetings from HDFC Bank!

Rs.50.00 is debited from your account ending 3101 towards VPA
************1234@okbizaxis (Mr KARTHIKEYAN M) on 18-10-26.

UPI transaction reference no.: ••1981.`
      )
    );
    expect(result.data).toMatchObject({
      amount: 50,
      instrument: 'upi',
      last4: '3101',
      merchant: 'Mr KARTHIKEYAN M',
      txnDate: '2026-10-18',
      txnTime: null,
    });
  });

  it('leaves the RuPay UPI alert payee-less: it prints only a masked handle', () => {
    // "Paid to **********wezb@pty" names nobody; the honest answer is no payee.
    const result = extractMessage(
      source('hdfc_alerts'),
      input(
        '❗  You have done a UPI txn. Check details!',
        `Dear *Customer*,

We're sharing this alert to help you quickly check a recent *UPI
transaction* made using your *RuPay Credit Card.*

*Transaction Details:Rs.10.00* has been *debited* from your *RuPay Credit
Card (ending 2101)*
Paid to **********wezb@pty*
Date:

*16-10-26UPI Transaction Reference Number: ••1063Important Note:*`
      )
    );
    expect(result.data).toMatchObject({ amount: 10, direction: 'debit', last4: '2101', merchant: null });
  });

  it('reads the time from an ICICI card alert', () => {
    const result = extractMessage(
      source('icici_cards'),
      input(
        'Transaction alert for your ICICI Bank Credit Card',
        `Dear Customer,

Your ICICI Bank Credit Card XX4123 has been used for a transaction of INR
68,516.22 on Oct 15, 2026 at 03:59:03. Info: HDFC ERGO GIC OTHER.

The Available Credit Limit on your card is INR 1,91,573.96 and Total Credit
Limit is INR 3,00,000.00.`
      )
    );
    expect(result.data).toMatchObject({
      amount: 68516.22,
      last4: '4123',
      merchant: 'HDFC ERGO GIC OTHER',
      txnDate: '2026-10-15',
      txnTime: '03:59:03',
    });
  });
});

// ICICI sends alerts and statements from one address (added 2026-09-14). Wording is
// synthetic until real ICICI mail has been through the inbox.
describe('Groww (one sender for statements, orders and offers)', () => {
  // SYNTHETIC — shaped on Groww's usual subjects until Bob's real mail comes through.
  it('records a statement mail with its PDF as a Groww investment statement', () => {
    const result = extractMessage(
      source('groww'),
      input('Your Groww mutual fund statement for August 2026', 'Please find attached your statement. The password is your PAN in capitals.', ['Statement_Aug_2026.pdf'])
    );
    expect(result.kind).toBe('investment_statement');
    expect(result.title).toBe('Groww statement');
    expect(result.data).toMatchObject({ provider: 'groww', hasAttachment: true });
  });

  it('keeps order confirmations and offers as notices', () => {
    const order = extractMessage(source('groww'), input('SIP instalment of ₹5,000 processed', 'Your SIP of Rs 5,000 in Parag Parikh Flexi Cap Fund has been processed.'));
    expect(order.kind).toBe('notice');
  });
});

describe('Kotak account statements', () => {
  it('names the bank the statement came from', () => {
    const result = extractMessage(
      source('kotak_account_statement'),
      input('Kotak Bank account statement for August 2026', 'Your account statement is attached.', ['statement.pdf'])
    );
    expect(result.title).toBe('Kotak Bank account statement');
  });
});

describe('Kotak alerts', () => {
  // SYNTHETIC — Kotak's real wording is unknown until Bob's mail comes through.
  it('reads a Kotak UPI debit', () => {
    const result = extractMessage(
      source('kotak_alerts'),
      input('Transaction alert', 'Rs.250.00 is debited from your Kotak Bank a/c XX1234 to VPA shop@okicici on 12-09-26. UPI Ref 123456789012.')
    );
    expect(result.data).toMatchObject({ bank: 'Kotak Bank', amount: 250, direction: 'debit', instrument: 'upi', last4: '1234' });
  });
});

describe('ICICI card Standing Instructions', () => {
  // Modelled on the real mails of 2026-09-11 and 2026-09-13 (Amazon, ₹300.04).
  it('reads a Standing Instruction that is due as a reminder, not a debit', () => {
    const result = extractMessage(
      source('icici_cards'),
      input(
        'Amazon through Standing Instruction YaLzJYDL2w is due',
        'Dear Customer, your payment of INR 300.04 towards Amazon through Standing Instruction YaLzJYDL2w is due on 13/09/2026 on your ICICI Bank Credit Card XX4123.'
      )
    );
    expect(result.kind).toBe('notice');
  });

  it('reads a processed Standing Instruction as a card debit to the merchant', () => {
    const result = extractMessage(
      source('icici_cards'),
      input(
        'Transaction Success notification for Standing Instruction on your ICICI Bank Credit Card',
        'Dear Customer, We have successfully processed your payment of INR 1,317.40 towards Amazon, with Standing Instruction YaLzJYDL2w, on 13/09/2026 on your ICICI Bank Credit Card XX4123. The amount has been received by the merchant.'
      )
    );
    expect(result.kind).toBe('transaction');
    expect(result.title).toBe('Amazon');
    expect(result.data).toMatchObject({ bank: 'ICICI Bank', amount: 1317.4, direction: 'debit', instrument: 'card', merchant: 'Amazon', outcome: 'success' });
  });
});

describe('ICICI card alert merchant', () => {
  // Shaped on the real alert of 2026-08-23, whose merchant was stored as "11:46:22. Info: AMAZON PAY…".
  it('takes the merchant after "Info:", not the time of day', () => {
    const result = extractMessage(
      source('icici_card_statement'),
      input(
        'Transaction alert for your ICICI Bank Credit Card',
        'Dear Customer, INR 5,699.95 spent using ICICI Bank Card XX4123 on 23-Aug-26 at 11:46:22. Info: AMAZON PAY IN E COMMERCE. The Available Credit Limit on 23-08-2026 is INR 2,34,567.00.'
      )
    );
    expect(result.data).toMatchObject({ amount: 5699.95, merchant: 'AMAZON PAY IN E COMMERCE', last4: '4123' });
  });
});

describe('ICICI statement address', () => {
  it('reads its mail without a statement as an alert, not a statement', () => {
    const result = extractMessage(
      source('icici_card_statement'),
      input('Payment received on your ICICI Bank Credit Card', 'Dear Customer, we have received your payment of INR 5,153.43 towards your ICICI Bank Credit Card XX4123.')
    );
    expect(result.kind).not.toBe('card_statement');
  });
});

describe('ICICI cards (mixed sender)', () => {
  it('reads a statement email as a card statement', () => {
    const result = extractMessage(
      source('icici_cards'),
      input(
        'ICICI Bank Credit Card Statement for September 2026',
        'Dear Customer, your Amazon Pay ICICI Bank Credit Card XX4123 statement is attached. Total Amount Due: Rs. 12,345.67 Payment Due Date: 30 Sep 2026.',
        ['4315XXXXXXXX4123_Sep2026.pdf']
      )
    );
    expect(result.kind).toBe('card_statement');
    expect(result.title).toBe('ICICI Bank card statement');
    expect(result.data).toMatchObject({ bank: 'ICICI Bank', last4: '4123', totalDue: 12345.67, dueDate: '2026-09-30' });
  });

  it('reads a transaction alert as a transaction', () => {
    const result = extractMessage(
      source('icici_cards'),
      input(
        'Transaction alert for your ICICI Bank Credit Card',
        'Dear Customer, INR 1,415.06 spent using ICICI Bank Card XX4123 on 12-Sep-26 on AMAZON. Avl Limit: INR 2,34,567.00.'
      )
    );
    expect(result.kind).toBe('transaction');
    expect(result.data).toMatchObject({ bank: 'ICICI Bank', amount: 1415.06, direction: 'debit', last4: '4123', instrument: 'card' });
  });

  it('turns other card mail into a notice', () => {
    const result = extractMessage(source('icici_cards'), input('Your reward points summary', 'You have earned 120 reward points this month.'));
    expect(result.kind).toBe('notice');
  });
});

describe('bank account statements', () => {
  it('records the statement and its period, without flagging it', () => {
    const result = extractMessage(
      source('hdfc_account_statement'),
      input(
        'Account Statement for period 01-Aug-2026 to 31-Aug-2026',
        'Dear Customer, please find attached your HDFC Bank account statement. The attachment is password protected.',
        ['Acct_Statement_XX3101_31082026.pdf']
      )
    );
    expect(result.kind).toBe('notice');
    expect(result.title).toBe('HDFC Bank account statement');
    expect(result.summary).toBe('Aug 2026 · PDF attached');
    expect(result.data).toMatchObject({ kind: 'notice', institution: 'HDFC Bank', keywords: [] });
  });
});

describe('card statements', () => {
  it('reads totals and dates from the body', () => {
    const result = extractMessage(
      source('hdfc_card_statement'),
      input(
        'Your HDFC Bank Credit Card Statement for September 2026',
        'Dear Card Member, Your statement for the HDFC Bank Credit Card ending 1234 is attached. Statement Date: 03 Sep 2026 Total Amount Due: Rs. 23,456.00 Minimum Amount Due: Rs. 1,180.00 Payment Due Date: 23 Sep 2026. The attachment is password protected.',
        ['Statement_Sep2026.pdf']
      )
    );

    expect(result.kind).toBe('card_statement');
    expect(result.title).toBe('HDFC Bank card statement');
    expect(result.summary).toBe('Due 23 Sep 2026 · ••1234');
    expect(result.data).toMatchObject({
      last4: '1234',
      statementDate: '2026-09-03',
      totalDue: 23456,
      minDue: 1180,
      dueDate: '2026-09-23',
      passwordProtected: true,
    });
  });

  it('still records a statement whose figures are only inside the PDF', () => {
    const result = extractMessage(
      source('axis_card_statement'),
      input(
        'Axis Bank Credit Card Statement',
        'Dear Customer, Please find attached your Axis Bank Credit Card statement. To open it, use the password as the first four letters of your name followed by your date of birth in DDMM format.',
        ['CC_Statement.pdf']
      )
    );

    expect(result.summary).toBe('PDF attached (password-protected)');
    expect(result.data).toMatchObject({ totalDue: null, dueDate: null, passwordProtected: true });
  });
});

describe('investment statements', () => {
  it('reads the period of a CDSL CAS', () => {
    const result = extractMessage(
      source('cdsl_cas'),
      input(
        'CDSL Consolidated Account Statement (CAS) for the period 01-08-2026 to 31-08-2026',
        'Dear Investor, Please find attached the Consolidated Account Statement for your demat accounts and mutual fund folios. The password to open the statement is your PAN in upper case.',
        ['CAS_082026.pdf']
      )
    );

    expect(result.kind).toBe('investment_statement');
    expect(result.title).toBe('CDSL consolidated account statement');
    expect(result.summary).toBe('Aug 2026 · PDF attached');
    expect(result.data).toMatchObject({
      provider: 'cdsl',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      amount: null,
      hasAttachment: true,
    });
  });

  it('reads an NPS contribution amount', () => {
    const result = extractMessage(
      source('nps_protean'),
      input(
        'NPS - Contribution credited to your PRAN',
        'Dear Subscriber, Contribution of Rs. 5,000.00 has been credited to your PRAN XXXXXXXX5678 under Tier I on 10-09-2026.'
      )
    );

    expect(result.title).toBe('NPS contribution credited');
    expect(result.data).toMatchObject({ provider: 'nps', amount: 5000 });
  });
});

// Subjects below are the real INDmoney wording, from the first live sync (2026-09-14).
describe('INDmoney', () => {
  it('reads a successful order from its subject', () => {
    const result = extractMessage(
      source('indmoney'),
      input('BUY order of Microsoft Inc. Class A for $161.37 is successful', '')
    );

    expect(result.kind).toBe('trade');
    expect(result.title).toBe('Bought Microsoft Inc. Class A');
    expect(result.data).toMatchObject({
      side: 'buy',
      symbol: 'Microsoft Inc. Class A',
      amount: 161.37,
      currency: 'USD',
      outcome: 'success',
    });
  });

  it('reads a sell order', () => {
    const result = extractMessage(source('indmoney'), input('SELL order of Nvidia Technology Inc. for $1010.25 is successful', ''));
    expect(result.data).toMatchObject({ side: 'sell', symbol: 'Nvidia Technology Inc.', amount: 1010.25 });
  });

  it('reads a cancelled order that quotes no amount', () => {
    const result = extractMessage(source('indmoney'), input('Buy order of Meta Platforms Inc. Class A is cancelled', ''));
    expect(result.title).toBe('Buy order cancelled · Meta Platforms Inc. Class A');
    expect(result.data).toMatchObject({ symbol: 'Meta Platforms Inc. Class A', amount: null, outcome: 'cancelled' });
  });

  it('records a dividend as a USD credit that is not flagged international', () => {
    const result = extractMessage(source('indmoney'), input('🔔 Alice, Dividend Received: $25.46 from Toyota Motor Co.', ''));
    expect(result.kind).toBe('transaction');
    expect(result.data).toMatchObject({
      amount: 25.46,
      currency: 'USD',
      direction: 'credit',
      merchant: 'Toyota Motor Co',
      international: false,
    });
  });

  // Live rows read "Dividend · Toyota Motor Co | Check Now View dividends from your US st…":
  // the name ran past the subject into the body's call to action.
  it('stops the dividend payer at the end of the subject line', () => {
    const result = extractMessage(
      source('indmoney'),
      input(
        '\u{1F514} Alice, Dividend Received: $3.41 from Microsoft Inc',
        'Check Now View dividends from your US stocks portfolio. Track them in the app.'
      )
    );
    expect(result.data).toMatchObject({ amount: 3.41, merchant: 'Microsoft Inc' });
  });

  it('stops the dividend payer at a layout pipe', () => {
    const result = extractMessage(
      source('indmoney'),
      input('Dividend Received: $15.02 from Microsoft Corporation Common Stock | Check Now', '')
    );
    expect(result.data).toMatchObject({ merchant: 'Microsoft Corporation Common Stock' });
  });

  it('treats a monthly statement as an investment statement', () => {
    const result = extractMessage(
      source('indmoney'),
      input('Your INDmoney US Stocks monthly statement for August 2026', 'Please find your statement attached.', ['statement.pdf'])
    );

    expect(result.data).toMatchObject({ kind: 'investment_statement', provider: 'indmoney', periodFrom: '2026-08-01' });
  });

  it('falls back to a notice for anything else', () => {
    const result = extractMessage(source('indmoney'), input('Funds added to your US Stocks wallet', 'Your transfer is complete.'));
    expect(result.kind).toBe('notice');
  });
});
