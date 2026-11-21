import { describe, it, expect } from 'vitest';
import { isSensitiveMessage } from '../guard';

describe('isSensitiveMessage', () => {
  it('drops OTP mail by subject', () => {
    expect(isSensitiveMessage('OTP for your transaction', 'Please find details')).toBe(true);
    expect(isSensitiveMessage('Your One Time Password', '')).toBe(true);
    expect(isSensitiveMessage('Reset your password', '')).toBe(true);
  });

  it('drops mail whose body carries a code', () => {
    expect(isSensitiveMessage('Transaction alert', 'Your OTP is 482913 for Rs 500 at AMAZON')).toBe(true);
    expect(isSensitiveMessage('Alert', '482913 is your one time password. Do not share it.')).toBe(true);
  });

  // Nearly every alert and statement ends with this footer. Treating it as an
  // OTP would silently discard every legitimate message.
  it('keeps mail that only warns about sharing an OTP', () => {
    expect(
      isSensitiveMessage(
        'Alert : Update on your HDFC Bank Credit Card',
        'Rs.499.00 is debited from your card ending 1234. Never share your OTP, card number or CVV with anyone.'
      )
    ).toBe(false);
  });

  it('keeps statement mail that mentions a PDF password', () => {
    expect(
      isSensitiveMessage('Axis Bank Credit Card Statement', 'To open it, use the password as the first four letters of your name.')
    ).toBe(false);
  });
});
