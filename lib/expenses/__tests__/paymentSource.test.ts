import { describe, expect, it } from 'vitest';
import { buildCardIndex, colorForIssuer, describePaymentSource, parsePaymentSource, tidyCardName } from '../paymentSource';

/** The household's real cards, oldest first, as GET /api/expenses/payment-sources returns them. */
const HOUSEHOLD = [
  { last4: '5179', name: 'Rewards card - 5179' },
  { last4: '2226', name: 'HDFC Regalia CC – 2226' },
  { last4: '1909', name: 'HDFC Swiggy CC – 1909' },
  { last4: '4123', name: 'Amazon ICICI CC – 4123' },
  { last4: '2101', name: 'HDFC UPI Rupay CC – 2101' },
  { last4: '2303', name: 'Axis RuPay – 2303' },
  { last4: '1515', name: 'HDFC Rupay - Bob - 1515' },
];

describe('parsePaymentSource', () => {
  it('splits the label automation writes', () => {
    expect(parsePaymentSource('HDFC Bank UPI ••1515')).toMatchObject({
      issuer: 'HDFC Bank',
      instrument: 'UPI',
      last4: '1515',
    });
  });

  it('reads every instrument automation can emit', () => {
    // INSTRUMENT_LABEL in lib/inbox/automation/owners.ts — the only three it writes.
    expect(parsePaymentSource('Axis Bank card ••2303')?.instrument).toBe('card');
    expect(parsePaymentSource('Kotak Bank account ••1234')?.instrument).toBe('account');
    expect(parsePaymentSource('HDFC Bank UPI ••3101')?.instrument).toBe('UPI');
  });

  it('keeps the issuer when the alert quoted no digits', () => {
    expect(parsePaymentSource('ICICI Bank card')).toMatchObject({
      issuer: 'ICICI Bank',
      instrument: 'card',
      last4: null,
    });
  });

  it('handles a bank name alone', () => {
    expect(parsePaymentSource('HDFC Bank')).toMatchObject({ issuer: 'HDFC Bank', instrument: null, last4: null });
  });

  it('accepts the other masking styles a person might type', () => {
    expect(parsePaymentSource('HDFC **1515')?.last4).toBe('1515');
    expect(parsePaymentSource('HDFC xx1515')?.last4).toBe('1515');
  });

  it('degrades to a plain label for anything hand-typed', () => {
    expect(parsePaymentSource('Google Pay')).toMatchObject({ issuer: 'Google Pay', instrument: null, last4: null });
  });

  it('recognises cash, which has no issuer to colour by', () => {
    expect(parsePaymentSource('Cash')).toMatchObject({ issuer: 'Cash', color: '#15803d' });
  });

  it('is null for nothing, so a caller renders no dot at all', () => {
    expect(parsePaymentSource(null)).toBeNull();
    expect(parsePaymentSource('')).toBeNull();
    expect(parsePaymentSource('   ')).toBeNull();
  });

  /*
   * Without a card index there is nothing to identify a card by, so the digits get a neutral
   * grey — never a brand colour. Asserting a *specific* colour here would be asserting the
   * hash; what matters is that an unidentified source cannot be mistaken for a known card,
   * which `buildCardIndex` below is what guarantees.
   */
  it('gives an unidentified source a neutral tone, not a card colour', () => {
    const grey = parsePaymentSource('HDFC Bank card ••9999')!.color;
    const known = buildCardIndex(HOUSEHOLD);
    expect([...known.values()].map((c) => c.color)).not.toContain(grey);
  });

  /*
   * A RuPay credit card pays both ways, and the alerts prove it: ••1515 arrives dozens of times as
   * "UPI" and 10 times as "card", ••2101 as 40 and 12. One piece of plastic, one colour —
   * keying on the instrument would make the list suggest twice as many cards as exist.
   */
  it('gives one card one colour whether it was tapped or paid by UPI', () => {
    expect(parsePaymentSource('HDFC Bank UPI ••1515')!.color).toBe(
      parsePaymentSource('HDFC Bank card ••1515')!.color
    );
    expect(parsePaymentSource('HDFC Bank UPI ••2101')!.color).toBe(
      parsePaymentSource('HDFC Bank card ••2101')!.color
    );
  });

  it('does not let two banks sharing a last4 collide', () => {
    expect(parsePaymentSource('HDFC Bank card ••1234')!.color).not.toBe(
      parsePaymentSource('Axis Bank card ••1234')!.color
    );
  });

  it('falls back to the brand colour when the alert named no card', () => {
    // 19 live rows are a bare "HDFC Bank card" — there is genuinely nothing finer to say.
    expect(parsePaymentSource('HDFC Bank card')!.color).toBe(colorForIssuer('HDFC Bank'));
    expect(parsePaymentSource('HDFC Bank UPI')!.color).toBe(colorForIssuer('HDFC'));
  });

  it('is stable across calls, so a row does not change colour on re-render', () => {
    const once = parsePaymentSource('HDFC Bank card ••1909')!.color;
    expect(parsePaymentSource('HDFC Bank card ••1909')!.color).toBe(once);
    expect(once).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('colours a bank it has never heard of, stably', () => {
    const first = colorForIssuer('Yes Bank');
    expect(first).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorForIssuer('Yes Bank')).toBe(first);
    expect(colorForIssuer('yes')).toBe(first);
  });
});

describe('tidyCardName', () => {
  /* Both separators are in live account names, and the digits are shown beside the name. */
  it('trims the digits Selvam appends, whichever dash was used', () => {
    expect(tidyCardName('HDFC Swiggy CC – 1909')).toBe('HDFC Swiggy CC');
    expect(tidyCardName('Rewards card - 5179')).toBe('Rewards card');
    expect(tidyCardName('HDFC Rupay - Bob - 1515')).toBe('HDFC Rupay - Bob');
  });

  it('leaves a name with no trailing digits alone', () => {
    expect(tidyCardName('UNI card')).toBe('UNI card');
  });

  it('never returns empty, even for a name that is only digits', () => {
    expect(tidyCardName('1909')).toBe('1909');
  });
});


describe('buildCardIndex', () => {
  /*
   * The reason this exists. Hashing ten cards into twelve hues collided in the live data —
   * HDFC ••1515 and ICICI ••4123 both came out cyan. Assigning by position cannot.
   */
  it('gives every card a different colour', () => {
    const index = buildCardIndex(HOUSEHOLD);
    const colors = HOUSEHOLD.map((c) => index.get(c.last4)!.color);
    expect(new Set(colors).size).toBe(HOUSEHOLD.length);
  });

  it('specifically separates the pair that collided under hashing', () => {
    const index = buildCardIndex(HOUSEHOLD);
    expect(index.get('1515')!.color).not.toBe(index.get('4123')!.color);
  });

  /* Appending a card must not recolour the ones already on screen. */
  it('keeps existing colours when a new card is added at the end', () => {
    const before = buildCardIndex(HOUSEHOLD);
    const after = buildCardIndex([...HOUSEHOLD, { last4: '9999', name: 'New CC – 9999' }]);
    for (const card of HOUSEHOLD) {
      expect(after.get(card.last4)!.color).toBe(before.get(card.last4)!.color);
    }
  });

  it('skips a card with no last4 rather than indexing under an empty key', () => {
    const index = buildCardIndex([{ last4: '', name: 'UNI card' }, ...HOUSEHOLD]);
    expect(index.has('')).toBe(false);
    expect(index.get('5179')!.name).toBe('Rewards card');
  });

  it('keeps the first of two accounts sharing a last4', () => {
    const index = buildCardIndex([...HOUSEHOLD, { last4: '5179', name: 'Duplicate – 5179' }]);
    expect(index.get('5179')!.name).toBe('Rewards card');
  });
});

describe('parsePaymentSource with a card index', () => {
  const index = buildCardIndex(HOUSEHOLD);

  it('names the card and takes its colour', () => {
    const source = parsePaymentSource('HDFC Bank card ••1909', index)!;
    expect(source.cardName).toBe('HDFC Swiggy CC');
    expect(source.color).toBe(index.get('1909')!.color);
  });

  /* One piece of plastic: the RuPay cards pay by UPI too, and must not read as two cards. */
  it('names the same card whichever rail it was paid on', () => {
    expect(parsePaymentSource('HDFC Bank UPI ••2101', index)!.cardName).toBe('HDFC UPI Rupay CC');
    expect(parsePaymentSource('HDFC Bank card ••2101', index)!.cardName).toBe('HDFC UPI Rupay CC');
  });

  /*
   * ••3101 and ••1303 are the HDFC bank accounts behind a UPI payment, not cards, so Selvam
   * has no name for them. They must still get a stable dot rather than disappearing.
   */
  it('falls back for digits that belong to no card', () => {
    const source = parsePaymentSource('HDFC Bank UPI ••3101', index)!;
    expect(source.cardName).toBeNull();
    expect(source.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('behaves exactly as before when no index is supplied', () => {
    expect(parsePaymentSource('HDFC Bank card ••1909')).toEqual(
      parsePaymentSource('HDFC Bank card ••1909', new Map())
    );
  });
});

describe('describePaymentSource', () => {
  const index = buildCardIndex(HOUSEHOLD);

  it('prefers the card name the household actually uses', () => {
    expect(describePaymentSource(parsePaymentSource('HDFC Bank card ••1909', index)!)).toBe(
      'HDFC Swiggy CC ••1909'
    );
  });

  it('drops the redundant "Bank" when there is no card name', () => {
    expect(describePaymentSource(parsePaymentSource('HDFC Bank UPI ••3101')!)).toBe('HDFC ••3101');
  });

  it('is just the issuer when there are no digits', () => {
    expect(describePaymentSource(parsePaymentSource('Cash')!)).toBe('Cash');
  });
});
