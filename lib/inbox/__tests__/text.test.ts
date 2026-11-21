import { describe, it, expect } from 'vitest';
import {
  findAmountAfter,
  findDate,
  findDates,
  findFirstAmount,
  findLast4,
  findMonthPeriod,
  findTxnTime,
  redact,
  stripEmphasis,
} from '../text';

describe('findFirstAmount', () => {
  it.each([
    ['Rs.1,234.50 is debited', 1234.5],
    ['INR 500 spent on', 500],
    ['₹ 99 paid to', 99],
    ['Rs 3,00,000 limit', 300000],
  ])('reads %s', (text, amount) => {
    expect(findFirstAmount(text)).toEqual({ amount, currency: 'INR' });
  });

  it('prefers the first amount, so a USD spend is not replaced by the INR limit after it', () => {
    expect(findFirstAmount('USD 20.00 spent at OPENAI. Available Limit: INR 80,000.00')).toEqual({
      amount: 20,
      currency: 'USD',
    });
  });

  it('returns null with no amount', () => {
    expect(findFirstAmount('Your card limit has been enhanced')).toBeNull();
  });
});

describe('findAmountAfter', () => {
  it('reads the figure following a label', () => {
    const text = 'Total Amount Due: Rs. 23,456.00 Minimum Amount Due: Rs. 1,180.00';
    expect(findAmountAfter(text, /total\s+amount\s+due/i)).toBe(23456);
    expect(findAmountAfter(text, /minimum\s+amount\s+due/i)).toBe(1180);
  });
});

describe('findDates', () => {
  it.each([
    ['on 12-09-26 at', '2026-09-12'],
    ['on 12/09/2026.', '2026-09-12'],
    ['on 12 Sep, 2026 at 20:15', '2026-09-12'],
    ['on Sep 12, 2026', '2026-09-12'],
    ['on 2026-09-12:20:15:11', '2026-09-12'],
    ['on 12-Sep-26', '2026-09-12'],
    ['by 5th October 2026', '2026-10-05'],
  ])('reads "%s" day-first', (text, iso) => {
    expect(findDate(text)).toBe(iso);
  });

  it('rejects impossible dates', () => {
    expect(findDate('on 31-02-2026')).toBeNull();
  });

  it('returns dates in order of appearance', () => {
    expect(findDates('for the period 01-08-2026 to 31-08-2026')).toEqual(['2026-08-01', '2026-08-31']);
  });

  it('does not read amounts or reference numbers as dates', () => {
    expect(findDates('Rs. 12,345.00 ref 123456789012')).toEqual([]);
  });
});

describe('findMonthPeriod', () => {
  it('expands a month name to its first and last day', () => {
    expect(findMonthPeriod('your statement for February 2028')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('findLast4', () => {
  it.each([
    ['Credit Card ending 1234', '1234'],
    ['Card no. XX5678', '5678'],
    ['from account **4321 to', '4321'],
    ['a/c no. XXXXXXXX9876', '9876'],
  ])('reads %s', (text, last4) => {
    expect(findLast4(text)).toBe(last4);
  });

  it('ignores unmasked numbers', () => {
    expect(findLast4('SMS BLOCK 1234 to 7308080808')).toBeNull();
  });
});

describe('redact', () => {
  it('masks PANs, including ones glued to underscores in file names', () => {
    expect(redact('PAN ABCDE1234F')).toBe('PAN [PAN]');
    expect(redact('CAS_ABCDE1234F_082026.pdf')).toBe('CAS_[PAN]_082026.pdf');
  });

  it('masks card, account and PRAN numbers down to the last four digits', () => {
    expect(redact('card 4111 1111 1111 1234')).toBe('card ••1234');
    expect(redact('PRAN 110012345678')).toBe('PRAN ••5678');
  });

  it('leaves dates and amounts alone', () => {
    expect(redact('on 12-09-2026 for Rs 12,345.00')).toBe('on 12-09-2026 for Rs 12,345.00');
  });
});

describe('htmlToText', () => {
  it('turns an HTML-only mail into readable lines', async () => {
    const { htmlToText, looksLikeHtml } = await import('../text');
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><style>p{color:red}</style></head>' +
      '<body><div>Your SIP of &#8377;5,000 in Parag Parikh Flexi Cap&nbsp;Fund</div><p>has been updated &amp; confirmed.</p></body></html>';
    expect(looksLikeHtml(html)).toBe(true);
    expect(looksLikeHtml('Dear Customer, Rs.500 debited')).toBe(false);
    expect(htmlToText(html)).toBe('Your SIP of ₹5,000 in Parag Parikh Flexi Cap Fund\nhas been updated & confirmed.');
  });
});

describe('stripEmphasis', () => {
  it('drops bold markers at word edges', () => {
    expect(stripEmphasis('ending *1909* towards *RSP*BHARTI AIRTEL LIMI* on *17 Oct*.')).toBe(
      'ending 1909 towards RSP*BHARTI AIRTEL LIMI on 17 Oct.'
    );
  });

  it('keeps a run of asterisks that masks a number', () => {
    expect(stripEmphasis('*Dear* *Customer*, towards VPA **********8723@okhdfcbank (Mr X)')).toBe(
      'Dear Customer, towards VPA **********8723@okhdfcbank (Mr X)'
    );
  });

  it('leaves mail that is not written in bold markup alone', () => {
    expect(stripEmphasis('USD 20.00 spent at OPENAI *CHATGPT SUBSCR on 10-09-26')).toBe(
      'USD 20.00 spent at OPENAI *CHATGPT SUBSCR on 10-09-26'
    );
  });
});

describe('findTxnTime', () => {
  it('reads the time a transaction sentence prints', () => {
    expect(findTxnTime('debited towards AIRTEL on 17 Oct, 2026 at 16:50:04.')).toBe('16:50:04');
    expect(findTxnTime('a transaction of INR 317.70 on Sep 27, 2026 at 12:11:34. Info: X')).toBe('12:11:34');
  });

  it('ignores a time that is not attached to the transaction date', () => {
    expect(findTxnTime('spent at MEGHA on 14-09-26. Call us 24x7, 09:00 to 18:00.')).toBeNull();
  });
});

describe('findLast4 on ICICI standing-instruction mail', () => {
  it('reads the bare "Credit Card 4123"', () => {
    expect(findLast4('through your ICICI Bank Credit Card 4123. Click here')).toBe('4123');
  });
});
