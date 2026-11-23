import type { InboxTransactionData } from '@/types';
import type { Extractor } from './types';
import { extractNotice } from './notice';
import { cleanPayee } from '../payee';
import { findAmountAfter, findDate, findFirstAmount, findLast4, findTime, findTxnTime, oneLine, readLabelledFields, stripEmphasis } from '../text';

/**
 * Transaction alerts (card spends, UPI, account debits/credits). Written against
 * the shapes HDFC and Axis use — "Rs.X is debited from … towards M on D",
 * "INR X spent on … at M on D", "Rs X credited to a/c **1234 by VPA …" — but
 * matches on shape, not exact wording, so a template tweak degrades to a
 * missing merchant rather than a lost alert. Mail with no amount, or no
 * debit/credit/declined wording (limit changes, EMI notices…) falls through to
 * a notice.
 */

const DEBIT =
  /\b(?:debited|spent|withdrawn|deducted|paid|sent|purchase|charged|thank\s+you\s+for\s+using|used\s+for|transaction\s+of)\b/i;
const CREDIT = /\b(?:credited|received|deposited|refund(?:ed)?)\b/i;
const DECLINED = /\b(?:declined|failed|unsuccessful|could\s+not\s+be\s+processed|not\s+been\s+processed)\b/i;
// Not a bare "international": alert footers mention international usage settings
// on every message, which flagged a domestic UPI credit as international.
const INTERNATIONAL = /\binternational\s+(?:transaction|spend|purchase|payment)/i;

// ICICI card Standing Instructions. The reminder that a debit "is
// due" moves no money but carried "payment of INR X towards M", so it was booked as a
// debit; the confirmation that did move money has no debit wording ("successfully
// processed your payment") and read as a notice, or as a credit when its footer said
// "received".
const SI_DUE = /\bstanding\s+instruction\b.{0,80}?\bis\s+due\b/i;
const SI_PAID = /\bsuccessfully\s+processed\s+your\s+payment\s+of\s+.{0,40}?\btowards\s+(.+?),?\s+with\s+standing\s+instruction\b/i;

const MERCHANT_PATTERNS: RegExp[] = [
  /\bto\s+vpa\s+\S+\s+(.+?)\s+on\s+\d/i,
  /\bat\s+(.+?)\s+on\s+(?:\d|date)/i,
  /\btowards\s+(.+?)\s+on\s+\d/i,
  /\bto\s+vpa\s+(\S+)/i,
  /\b(?:by|from)\s+vpa\s+(\S+)/i,
  // \b on both sides: without the trailing one this matched inside "information"
  // and "inform you", producing merchants like "rmation above includes…".
  /\binfo\b:?\s*([^.]+?)(?:\.|$)/i,
];

function firstIndex(text: string, re: RegExp): number {
  return text.match(re)?.index ?? Number.POSITIVE_INFINITY;
}

/**
 * Prose, not a payee. `at (.+?) on \d` has the whole mail to roam over, and an alert
 * with no real "at MERCHANT on DATE" let it latch onto the safety footer instead:
 * every HDFC NEFT/IMPS debit came through as the payee "all times. If you have not
 * done above transaction, please i…", which is what 12 of the 19 transfers waiting
 * for review were called.
 *
 * The rules live in `lib/inbox/payee.ts`, shared with the list and the classify sheet,
 * which have to make the same judgement about rows written before this guard existed.
 */
const cleanMerchant = cleanPayee;

/**
 * Labels a bank puts the payee under in a two-column alert. Axis says "Merchant Name"; the
 * others are the same idea in different words, and an unknown one simply does not match.
 */
const MERCHANT_LABELS = ['merchant name', 'merchant', 'payee name', 'payee', 'beneficiary name', 'beneficiary', 'paid to', 'to'];

function findMerchant(text: string, fields: Map<string, string>): string | null {
  // A labelled field says outright what the payee is, so it outranks every pattern below,
  // which only infer one from the shape of a sentence.
  for (const label of MERCHANT_LABELS) {
    const merchant = fields.has(label) ? cleanMerchant(fields.get(label) as string) : null;
    if (merchant) return merchant;
  }
  for (const re of MERCHANT_PATTERNS) {
    const match = text.match(re);
    const merchant = match ? cleanMerchant(match[1]) : null;
    if (merchant) return merchant;
  }
  return null;
}

const INSTRUMENT_LABEL: Record<NonNullable<InboxTransactionData['instrument']>, string> = {
  card: 'card',
  account: 'account',
  upi: 'UPI',
};

export const extractBankAlert: Extractor = (source, input) => {
  const body = stripEmphasis(input.body);
  const text = oneLine(`${input.subject} ${body}`);
  // Read before flattening: one field per line is what makes the split unambiguous.
  const fields = readLabelledFields(body);
  const first = findFirstAmount(text);
  const standingInstruction = text.match(SI_PAID);
  if (!standingInstruction && SI_DUE.test(text)) return extractNotice(source, input);

  const debitAt = firstIndex(text, DEBIT);
  const creditAt = firstIndex(text, CREDIT);
  const declined = DECLINED.test(text);
  const noVerb =
    !standingInstruction && debitAt === Number.POSITIVE_INFINITY && creditAt === Number.POSITIVE_INFINITY && !declined;

  if (!first || noVerb) return extractNotice(source, input);

  // "Date & Time: 19-09-2026, 13:20:46 IST" holds both, and reading the date from it beats
  // scanning the whole mail, where a footer date can come first.
  const dated = fields.get('date & time') ?? fields.get('date and time') ?? fields.get('transaction date') ?? fields.get('date') ?? '';

  // A declined attempt with no debit/credit wording is still an attempted spend.
  const direction = standingInstruction || debitAt <= creditAt ? 'debit' : 'credit';
  const instrument: InboxTransactionData['instrument'] = standingInstruction
    ? 'card'
    : /\bupi\b|\bvpa\b/i.test(text)
    ? 'upi'
    : /\bcard\b/i.test(text)
      ? 'card'
      : /\ba\/c\b|\baccount\b/i.test(text)
        ? 'account'
        : null;

  const data: InboxTransactionData = {
    kind: 'transaction',
    bank: source.institution,
    amount: first.amount,
    currency: first.currency,
    direction,
    instrument,
    last4: findLast4(text),
    merchant: (standingInstruction ? cleanMerchant(standingInstruction[1]) : null) ?? findMerchant(text, fields),
    txnDate: findDate(dated) ?? findDate(oneLine(body)) ?? input.receivedDate,
    // When the spend happened, not when the mail arrived. It separates two same-day spends at
    // one merchant, and it is the context a person uses to recognise a payment they half forgot.
    txnTime: findTime(dated) ?? findTxnTime(text),
    available: findAmountAfter(text, /(?:avl|available)\.?\s*(?:bal(?:ance)?|limit|lmt)/i),
    outcome: declined ? 'declined' : 'success',
    international: first.currency !== 'INR' || INTERNATIONAL.test(text),
  };

  const instrumentText = [
    source.institution,
    instrument ? INSTRUMENT_LABEL[instrument] : null,
    data.last4 ? `••${data.last4}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    kind: 'transaction',
    title: data.merchant ?? (direction === 'credit' ? 'Money received' : 'Payment'),
    summary: [
      direction === 'credit' ? 'Credit' : 'Debit',
      instrumentText,
      data.outcome === 'declined' ? 'Declined' : null,
      data.international ? 'International' : null,
    ]
      .filter(Boolean)
      .join(' · '),
    data,
  };
};
