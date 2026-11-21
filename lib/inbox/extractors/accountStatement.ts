import type { Extractor } from './types';
import { detectNoticeKeywords } from './notice';
import { findDates, findMonthPeriod, oneLine, redact, truncate } from '../text';
import { formatters } from '@/lib/utils/dateUtils';

/**
 * Bank account statements (HDFC's netbanking auto-mailer). The figures are in the
 * attached PDF, which goes through the statement pipeline; the inbox item just
 * records that a statement arrived and the period it covers. Stored as a notice —
 * there is no account-statement kind in inbox_items yet, and nothing needs one
 * until the PDF is parsed into balances.
 */
export const extractAccountStatement: Extractor = (source, input) => {
  const text = oneLine(`${input.subject} ${input.body}`);
  const hasPdf = input.attachmentNames.some((name) => /\.pdf$/i.test(name));

  const label = text.match(/(?:statement\s+)?(?:for\s+the\s+)?period(?:\s+from)?|\bfrom\b/i);
  const start = label?.index !== undefined ? label.index + label[0].length : -1;
  const dates = start >= 0 ? findDates(text.slice(start, start + 60)) : [];
  const period = dates.length >= 2 && dates[0] <= dates[1] ? { from: dates[0], to: dates[1] } : findMonthPeriod(text);

  const periodLabel = period
    ? period.from.slice(0, 7) === period.to.slice(0, 7)
      ? formatters.toMonthYear(period.from)
      : `${formatters.toFullDate(period.from)} – ${formatters.toFullDate(period.to)}`
    : null;

  return {
    kind: 'notice',
    title: `${source.institution} account statement`,
    summary: truncate(redact([periodLabel, hasPdf ? 'PDF attached' : null].filter(Boolean).join(' · ')), 140) || null,
    data: {
      kind: 'notice',
      institution: source.institution,
      keywords: detectNoticeKeywords(text),
      amount: null,
    },
  };
};
