import type { Extractor } from './types';
import { findAmount, oneLine, redact, truncate } from '../text';

/**
 * Wording that means someone has to do something. Detected on every notice;
 * `attention.ts` flags a notice that carries any of them.
 */
const NOTICE_KEYWORDS: { label: string; re: RegExp }[] = [
  { label: 'Mandate failed', re: /mandate\b.{0,60}\b(?:fail|reject|declin|bounc|unsuccess)|(?:fail|reject|declin|bounc|unsuccess)\w*\b.{0,60}\bmandate/i },
  { label: 'SIP failed', re: /\bsip\b.{0,60}\b(?:fail|reject|bounc|unsuccess)|(?:fail|reject|bounc|unsuccess)\w*\b.{0,60}\bsip\b/i },
  { label: 'EMI issue', re: /\bemi\b.{0,60}\b(?:bounc|fail|overdue|unpaid)/i },
  { label: 'KYC', re: /\b(?:re-?)?kyc\b/i },
  { label: 'Nominee', re: /\bnominee\b|\bnomination\b/i },
  { label: 'Action required', re: /action\s+required|immediate\s+attention|past\s+due|\boverdue\b/i },
];

export function detectNoticeKeywords(text: string): string[] {
  return NOTICE_KEYWORDS.filter(({ re }) => re.test(text)).map(({ label }) => label);
}

/**
 * Fallback for anything a dedicated extractor could not read: the subject as
 * the title and, at most, one short redacted sentence — never the body.
 */
export const extractNotice: Extractor = (source, input) => {
  const subject = truncate(redact(oneLine(input.subject)), 120);
  const body = oneLine(input.body);
  const text = `${input.subject} ${body}`;
  const keywords = detectNoticeKeywords(text);

  const sentence = body
    .split(/(?<=[.!?])\s+/)
    .find((s) => findAmount(s) !== null || detectNoticeKeywords(s).length > 0);

  return {
    kind: 'notice',
    title: subject || `Message from ${source.institution}`,
    summary: sentence ? truncate(redact(sentence), 140) : null,
    data: {
      kind: 'notice',
      institution: source.institution,
      keywords,
      amount: findAmount(text),
    },
  };
};
