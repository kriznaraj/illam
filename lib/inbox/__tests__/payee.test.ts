import { describe, it, expect } from 'vitest';
import { cleanPayee } from '../payee';

/**
 * The junk strings below are the real `data.merchant` values sitting in `inbox_items`
 * on 2026-09-27, written by extractor versions 4 and 5. They are the reason this
 * module exists, so they are the fixtures: a rule that stops salvaging them is a
 * regression, whatever else it makes pass.
 */
describe('cleanPayee', () => {
  describe('refuses prose a pattern wandered into', () => {
    // The footer of every HDFC NEFT/IMPS alert. 9 inbox items and 7 transfers hold it.
    it('refuses the HDFC safety footer', () => {
      expect(cleanPayee('all times. If you have not done above transaction, please i…')).toBeNull();
    });

    it.each([
      'If you have not authorised this transaction',
      'Please call our customer care immediately',
      'Do not share your OTP with anyone',
      'at all times for your safety',
      'Kindly ignore if already paid',
    ])('refuses %s', (text) => {
      expect(cleanPayee(text)).toBeNull();
    });

    it('refuses a candidate longer than a name', () => {
      expect(cleanPayee('one two three four five six seven eight nine')).toBeNull();
      expect(cleanPayee('one two three four five six seven eight')).toBe('one two three four five six seven eight');
    });

    it('refuses a timestamp and an account number', () => {
      expect(cleanPayee('11:46:22')).toBeNull();
      expect(cleanPayee('50100123456789')).toBeNull();
    });
  });

  describe('salvages the name out of text that would otherwise be refused', () => {
    it("drops a payment aggregator's code glued to a card descriptor", () => {
      expect(cleanPayee('RSP*BHARTI AIRTEL LIMI')).toBe('BHARTI AIRTEL LIMI');
    });

    // ICICI puts the merchant after "Info:"; everything around it is clock and credit limit.
    it.each([
      ['11:46:22. Info: AMAZON PAY IN E COMMERCE. The Available Cre…', 'AMAZON PAY IN E COMMERCE'],
      ['04:41:02. Info: AMAZON PAY IN GROCERY. The Available Credit…', 'AMAZON PAY IN GROCERY'],
      ['01:30:29. Info: NETFLIX. The Available Credit Limit on your…', 'NETFLIX'],
      ['11:13:04. Info: AMAZON INDIA CYBS SI. The Available Credit…', 'AMAZON INDIA CYBS SI'],
    ])('reads %s as the payee', (stored, expected) => {
      expect(cleanPayee(stored)).toBe(expected);
    });

    // An INDmoney subject that ran into the body through a layout pipe.
    it.each([
      ['Microsoft Corporation Common Stock | Check Now View dividen…', 'Microsoft Corporation Common Stock'],
      ['Novo-Nordisk A/S | Check Now View dividends from your US st…', 'Novo-Nordisk A/S'],
    ])('cuts %s at the layout pipe', (stored, expected) => {
      expect(cleanPayee(stored)).toBe(expected);
    });

    it('takes the name a UPI handle is annotated with', () => {
      expect(cleanPayee('VPA someone@okhdfcbank (Daniel R)')).toBe('Daniel R');
      expect(cleanPayee('vpa merchant@ybl')).toBe('merchant@ybl');
    });
  });

  describe('leaves an ordinary payee alone', () => {
    it.each([
      'BALAALICEN ENTERPRISES',
      'KANNAN STORES',
      'KERALA SNACK STORE',
      'SRI CITY MEDICALS',
      'FINZOOM INVESTMENT ADVISORS PRIVATE LIMITED',
      'NETFLIX',
      'Ramasamy',
      'CBDT TIN 2 0',
    ])('keeps %s', (payee) => {
      expect(cleanPayee(payee)).toBe(payee);
    });

    it('strips trailing punctuation and brackets', () => {
      expect(cleanPayee('KANNAN STORES.')).toBe('KANNAN STORES');
      expect(cleanPayee('(KANNAN STORES)')).toBe('KANNAN STORES');
    });

    it('truncates rather than refusing a long single name', () => {
      const long = `${'A'.repeat(80)}`;
      expect(cleanPayee(long)).toHaveLength(60);
      expect(cleanPayee(long)?.endsWith('…')).toBe(true);
    });
  });

  it('answers null for nothing at all', () => {
    expect(cleanPayee(null)).toBeNull();
    expect(cleanPayee(undefined)).toBeNull();
    expect(cleanPayee('   ')).toBeNull();
  });
});
