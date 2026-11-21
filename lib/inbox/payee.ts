/**
 * One reader of "is this string a payee?", shared by extraction and display.
 *
 * The extractor guards this at write time (`cleanMerchant` in extractors/bankAlert.ts
 * delegates here), but rows written by earlier extractor versions are already in the
 * table and nothing re-reads them. Three families are stored today:
 *
 * - `"all times. If you have not done above transaction, please i…"` — extractor v4's
 *   `at (.+?) on \d` had the whole mail to roam over, and with no real "at MERCHANT on
 *   DATE" in an HDFC NEFT/IMPS alert it latched onto the safety footer. 9 inbox items
 *   and 7 transfers carry it. Nothing is recoverable: it degrades to null.
 * - `"11:46:22. Info: AMAZON PAY IN E COMMERCE. The Available Cre…"` — the same pattern
 *   on an ICICI card alert, which starts at the clock time. The payee *is* in there,
 *   after `Info:`, which is where ICICI puts it. 11 rows, all salvageable.
 * - `"Microsoft Corporation Common Stock | Check Now View dividen…"` — an INDmoney
 *   subject that ran into the body through a layout pipe. Cut at the pipe and the
 *   payer is intact.
 *
 * So this salvages first and only then refuses, because "Payment" tells a person less
 * than "AMAZON PAY IN E COMMERCE" and both were sitting in the same column.
 *
 * Pure and deterministic — same string in, same answer out, server and browser.
 */

/** A payee is a name. Two sentences is prose that a pattern wandered into. */
const SENTENCE = /[.!?]\s+\S/;

/** Phrases that only ever appear in an alert's safety footer, never in a merchant's name. */
const FOOTER_PHRASE =
  /\b(?:if\s+you\s+have\s+not|please\s+(?:call|contact|report|note|ignore|do\s+not)|do\s+not\s+share|never\s+share|customer\s+care|toll[\s-]?free|helpline|at\s+all\s+times|kindly)\b/i;

/** A clock time is where a pattern caught the time of day. */
const LEADING_TIME = /^\d{1,2}:\d{2}/;

/** An account, card, folio or PRAN number that slipped through as a name. */
const LONG_DIGITS = /\d{6,}/;

const MAX_PAYEE_WORDS = 8;
const MAX_PAYEE_CHARS = 60;

/** "VPA someone@okhdfcbank (Daniel R)" → "Daniel R". */
const VPA_NAMED = /^(?:vpa\s+)?\S+@\S+\s*\((.+)\)$/i;

/**
 * ICICI card alerts read "…at 11:46:22. Info: AMAZON PAY IN GROCERY. The Available
 * Credit Limit on your card is…". Everything before `Info:` is a timestamp and
 * everything after the next full stop is the limit sentence; the payee is between them.
 */
const INFO_SEGMENT = /\binfo\s*:\s*([^.]+)/i;

/**
 * A layout pipe separates a subject from whatever the mail's own markup glued onto it
 * ("Check Now", "View dividends from your US st…"). The name is what comes first.
 */
const LAYOUT_PIPE = /\s*\|\s*/;

/**
 * A payee, or null when the candidate is prose, a timestamp or a number.
 *
 * Accepts anything — a fresh regex capture, or a value read back out of the database
 * that an older extractor already truncated to 60 characters with an ellipsis.
 */
export function cleanPayee(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let payee = raw.replace(/[\s.,;:-]+$/, '').trim();
  if (!payee) return null;

  // The name in the brackets is what a person recognises, and it keeps third parties'
  // UPI handles out of the table.
  const named = payee.match(VPA_NAMED);
  if (named) payee = named[1].trim();
  payee = payee.replace(/^vpa\s+/i, '').replace(/^\((.+)\)$/, '$1').trim();

  // Salvage before judging: both of these carry a real name inside text that would
  // otherwise be refused as prose.
  const info = payee.match(INFO_SEGMENT);
  if (info) payee = info[1].trim();
  payee = payee.split(LAYOUT_PIPE)[0].trim();
  // A payment aggregator's code glued to the merchant on card descriptors: "RSP*BHARTI AIRTEL
  // LIMI" is Bharti Airtel, and the keyword matcher only finds it without the prefix.
  payee = payee.replace(/^[A-Z]{2,5}\s?\*\s?(?=[A-Za-z])/, '').trim();

  // A truncation the extractor applied before storing, now mid-salvage.
  payee = payee.replace(/[…]+$/, '').replace(/[\s.,;:-]+$/, '').trim();

  if (!payee) return null;
  if (LONG_DIGITS.test(payee) || LEADING_TIME.test(payee)) return null;
  if (SENTENCE.test(payee) || FOOTER_PHRASE.test(payee)) return null;
  if (payee.split(/\s+/).length > MAX_PAYEE_WORDS) return null;

  return payee.length <= MAX_PAYEE_CHARS ? payee : `${payee.slice(0, MAX_PAYEE_CHARS - 1).trimEnd()}…`;
}
