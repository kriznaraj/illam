import type { InboxInvestmentStatementData } from '@/types';
import type { Extractor } from './types';
import { findAmount, findDates, findMonthPeriod, oneLine } from '../text';
import { formatters } from '@/lib/utils/dateUtils';

/**
 * CAS (CDSL/NSDL) and NPS statement mail. The holdings live in the attached
 * PDF, which the inbox does not read yet — here the item records that a
 * statement arrived and which period it covers. Turning the PDF into Selvam
 * holdings is a follow-up that consumes these items.
 */

const TITLES: Record<InboxInvestmentStatementData['provider'], string> = {
  cdsl: 'CDSL consolidated account statement',
  nsdl: 'NSDL consolidated account statement',
  nps: 'NPS statement',
  indmoney: 'INDmoney statement',
  groww: 'Groww statement',
  zerodha: 'Zerodha statement',
};

const PERIOD_LABEL = /(?:statement\s+)?(?:for\s+the\s+)?period(?:\s+from)?|\bfrom\b/i;

function findPeriod(text: string): { from: string; to: string } | null {
  const label = text.match(PERIOD_LABEL);
  if (label?.index !== undefined) {
    const start = label.index + label[0].length;
    const dates = findDates(text.slice(start, start + 60));
    if (dates.length >= 2 && dates[0] <= dates[1]) return { from: dates[0], to: dates[1] };
  }
  return findMonthPeriod(text);
}

export const extractInvestmentStatement: Extractor = (source, input) => {
  const text = oneLine(`${input.subject} ${input.body}`);
  const provider = source.provider ?? 'cdsl';
  const period = findPeriod(text);
  const hasAttachment = input.attachmentNames.length > 0;

  const data: InboxInvestmentStatementData = {
    kind: 'investment_statement',
    provider,
    periodFrom: period?.from ?? null,
    periodTo: period?.to ?? null,
    // NPS contribution mails quote the amount credited; CAS mails quote none.
    amount: /contribution|credited|units\s+allotted/i.test(text) ? findAmount(text) : null,
    hasAttachment,
  };

  const periodLabel = period
    ? period.from.slice(0, 7) === period.to.slice(0, 7)
      ? formatters.toMonthYear(period.from)
      : `${formatters.toFullDate(period.from)} – ${formatters.toFullDate(period.to)}`
    : null;

  return {
    kind: 'investment_statement',
    title: provider === 'nps' && data.amount !== null ? 'NPS contribution credited' : TITLES[provider],
    summary: [periodLabel, hasAttachment ? 'PDF attached' : null].filter(Boolean).join(' · ') || null,
    data,
  };
};
