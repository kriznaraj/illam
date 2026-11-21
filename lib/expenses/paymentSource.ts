/**
 * Reading `expenses.payment_method` back into its parts, so the list can show *which*
 * account a spend left without spending a whole line on it.
 *
 * The string is built by `paymentMethodLabel` in lib/inbox/automation/owners.ts as
 * `<institution> <instrument> ••<last4>`, e.g. "HDFC Bank UPI ••1515". Parsing it back
 * rather than adding columns keeps one writer and one reader of the format, and works on
 * every row already stored — including the ones a person typed by hand, which follow no
 * format at all and degrade to a plain label with a derived colour.
 *
 * Pure and deterministic: same string in, same colour out, on the server and in the browser.
 */

export interface PaymentSource {
  /** "HDFC Bank", or the whole string when it does not parse. */
  issuer: string;
  /** 'card' | 'UPI' | 'account' when the label names one. */
  instrument: string | null;
  /** The masked digits, without the bullets. */
  last4: string | null;
  /** Stable hex colour, per card — see `colorForCard` and `buildCardIndex`. */
  color: string;
  /** What to put in a tooltip: the original string, unchanged. */
  label: string;
  /**
   * The account's own name in Selvam ("HDFC Swiggy CC"), when these digits match a card the
   * household holds. Null for a method that names no card, and for the two bank accounts
   * whose UPI shows up here (••3101, ••1303) — they are not cards and have no name to borrow.
   */
  cardName: string | null;
}

/** One credit card as Selvam knows it, for `buildCardIndex`. */
export interface KnownCard {
  last4: string;
  /** `portfolio_accounts.name`, e.g. "HDFC Swiggy CC – 1909". */
  name: string;
}

export interface CardStyle {
  name: string;
  color: string;
}

/** One card as GET /api/expenses/payment-sources returns it, oldest first. */
export interface PaymentSourceCard extends KnownCard {
  color: string;
}

/** last4 → how to name and colour it. Built once from Selvam, passed down to the rows. */
export type CardIndex = ReadonlyMap<string, CardStyle>;

/**
 * Brand colours, used **only when the method names no card or account**, e.g. a bare
 * "HDFC Bank card" — 19 such rows exist, where the alert quoted no digits and there is
 * genuinely nothing finer to say.
 *
 * Anything unlisted falls through to the palette, which is why adding a bank to
 * `sources.ts` needs no change here.
 */
const ISSUER_COLORS: Record<string, string> = {
  hdfc: '#004c8f',
  axis: '#97144d',
  icici: '#e07b39',
  kotak: '#d32f2f',
  sbi: '#2d6cb6',
  indmoney: '#0f9d58',
  finzoom: '#0f9d58',
  cred: '#1f2937',
};

/**
 * One colour per card, not per bank.
 *
 * The first cut of this file coloured by issuer, which is useless when one bank dominates:
 * a household can easily have half its payment methods at HDFC — several credit cards, a
 * couple of RuPay cards, plus the bank accounts. All of them drew the same navy dot, so the
 * dot said nothing the row did not already say.
 *
 * Twelve hues, spaced around the wheel and all dark enough to read as a 10px square on
 * white. Ten distinct sources today, so collisions are possible but not yet real; two cards
 * that do collide are still told apart by the tooltip and the detail modal.
 */
const CARD_PALETTE = [
  '#0369a1', // blue
  '#be185d', // pink
  '#15803d', // green
  '#b45309', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#b91c1c', // red
  '#4d7c0f', // olive
  '#6366f1', // indigo
  '#a16207', // ochre
  '#9d174d', // maroon
  '#047857', // teal
];

/** Cash is the one method worth recognising by name — it has no issuer to colour by. */
const CASH = /^\s*cash\b/i;

const INSTRUMENTS = ['upi', 'card', 'account', 'netbanking', 'wallet'];

function hashIndex(value: string, buckets: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % buckets;
}

/** The issuer key used for colouring: first word, lowercased, "Bank"/"Ltd" dropped. */
function issuerKey(issuer: string): string {
  const first = issuer.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return first.replace(/[^a-z0-9]/g, '');
}

/** The brand colour, for a method that names no particular card. */
export function colorForIssuer(issuer: string): string {
  const key = issuerKey(issuer);
  if (!key) return CARD_PALETTE[0];
  return ISSUER_COLORS[key] ?? CARD_PALETTE[hashIndex(key, CARD_PALETTE.length)];
}

/**
 * The colour for one card or account.
 *
 * Only reached when the digits match no card in the index — `buildCardIndex` colours the
 * real ones. Keyed on issuer **and** last4, so two banks' ••1234 do not collide, and
 * deliberately *not* on the instrument: a RuPay credit card pays both ways, so ••1515
 * arrives dozens of times as "UPI" and 10 times as "card", ••2101 as 40 and 12. One piece of
 * plastic, one colour, or the list would suggest twice as many cards as exist.
 */
export function colorForCard(issuer: string, last4: string | null): string {
  if (!last4) return colorForIssuer(issuer);
  return UNKNOWN_PALETTE[hashIndex(`${issuerKey(issuer)}:${last4}`, UNKNOWN_PALETTE.length)];
}

/**
 * Trim the digits Selvam appends to a card's name, since the row shows them separately:
 * "HDFC Swiggy CC – 1909" → "HDFC Swiggy CC". Handles the en dash and the hyphen, both of
 * which are in live account names ("Rewards card - 5179", "HDFC Regalia CC – 2226").
 */
export function tidyCardName(name: string): string {
  return name.replace(/\s*[–—-]\s*\d{3,6}\s*$/, '').trim() || name.trim();
}

/**
 * For a last4 that belongs to no card Selvam knows — today ••3101 and ••1303, the HDFC bank
 * accounts behind a UPI payment, which are not recorded as accounts anywhere.
 *
 * A **disjoint** set of greys, deliberately: hashing these into CARD_PALETTE put ••3101 on
 * Millennia's violet and ••1303 on the UPI RuPay's pink, which is worse than no colour,
 * because it asserts a card the spend did not come from. Keeping the two palettes apart
 * makes that collision impossible rather than unlikely, and the neutral tone reads as
 * "some account", not "one of your cards". Add the account to Selvam with its last4 and it
 * graduates to a real colour and a real name.
 */
const UNKNOWN_PALETTE = ['#64748b', '#78716c', '#475569', '#a8a29e', '#57534e', '#94a3b8'];

/**
 * Colour every card the household holds, by position rather than by hash.
 *
 * A hash over ten cards collides: with the twelve-hue palette, HDFC ••1515 and ICICI ••4123
 * drew the same cyan in the live data. Walking the list instead makes a clash impossible
 * while there are no more cards than colours, and appending a new card cannot recolour the
 * existing ones as long as the caller keeps the order stable (oldest first).
 *
 * Cards past the twelfth wrap around, which is a real but distant limit — nine accounts
 * exist today, two of them closed.
 */
export function buildCardIndex(cards: readonly KnownCard[]): CardIndex {
  const index = new Map<string, CardStyle>();
  cards.forEach((card, position) => {
    if (!card.last4 || index.has(card.last4)) return;
    index.set(card.last4, { name: tidyCardName(card.name), color: CARD_PALETTE[position % CARD_PALETTE.length] });
  });
  return index;
}

export function parsePaymentSource(
  method: string | null | undefined,
  cards?: CardIndex
): PaymentSource | null {
  const label = (method ?? '').trim();
  if (!label) return null;

  if (CASH.test(label)) {
    return { issuer: 'Cash', instrument: null, last4: null, color: '#15803d', label, cardName: null };
  }

  // "••1515", "**1515", "xx1515" or a bare 4-digit tail.
  const masked = label.match(/(?:[•*xX]{2,}\s*)(\d{3,6})\s*$/);
  const last4 = masked ? masked[1] : null;
  const withoutDigits = masked ? label.slice(0, masked.index).trim() : label;

  const words = withoutDigits.split(/\s+/).filter(Boolean);
  const tail = words[words.length - 1]?.toLowerCase() ?? '';
  const hasInstrument = INSTRUMENTS.includes(tail);
  const instrument = hasInstrument ? words[words.length - 1] : null;
  const issuer = (hasInstrument ? words.slice(0, -1) : words).join(' ') || withoutDigits || label;

  // A card Selvam knows wins on both name and colour; anything else falls back to the hash,
  // so an account the portfolio does not track still gets a stable dot.
  const known = last4 ? cards?.get(last4) : undefined;
  return {
    issuer,
    instrument,
    last4,
    color: known?.color ?? colorForCard(issuer, last4),
    label,
    cardName: known?.name ?? null,
  };
}

/**
 * What to show a person: the card's own name when Selvam has one, else the issuer.
 * "HDFC Swiggy CC ••1909", or "HDFC ••3101" for the bank account behind a UPI payment.
 */
export function describePaymentSource(source: PaymentSource): string {
  const head = source.cardName ?? source.issuer.replace(/\s+bank$/i, '');
  return source.last4 ? `${head} ••${source.last4}` : head;
}
