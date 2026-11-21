import type { InboxCardStatementData } from '@/types';
import type { Extractor } from './types';
import { findAmountAfter, findDateAfter, findLast4, oneLine } from '../text';
import { formatters } from '@/lib/utils/dateUtils';

/**
 * Credit-card statement mail. The figures that matter — total due, minimum
 * due, due date — are usually repeated in the email body; when they are not,
 * the item still records that a (typically password-protected) PDF arrived,
 * which is enough to raise "new card statement".
 */

const TOTAL_DUE = /total\s+(?:amount\s+)?dues?|total\s+outstanding|amount\s+payable/i;
const MIN_DUE = /min(?:imum)?\.?\s+(?:amount\s+)?dues?/i;
const DUE_DATE = /(?:payment\s+)?due\s+date|pay(?:ment)?\s+by/i;
const STATEMENT_DATE = /statement\s+(?:date|generated\s+on|dated)/i;

export const extractCardStatement: Extractor = (source, input) => {
  const text = oneLine(`${input.subject} ${input.body}`);
  const hasPdf = input.attachmentNames.some((name) => /\.pdf$/i.test(name));

  const data: InboxCardStatementData = {
    kind: 'card_statement',
    bank: source.institution,
    last4: findLast4(text),
    statementDate: findDateAfter(text, STATEMENT_DATE),
    totalDue: findAmountAfter(text, TOTAL_DUE),
    minDue: findAmountAfter(text, MIN_DUE),
    dueDate: findDateAfter(text, DUE_DATE),
    passwordProtected: hasPdf && /password/i.test(text),
  };

  const summary = [
    data.dueDate ? `Due ${formatters.toFullDate(data.dueDate)}` : null,
    data.last4 ? `••${data.last4}` : null,
    data.totalDue === null && hasPdf
      ? data.passwordProtected
        ? 'PDF attached (password-protected)'
        : 'PDF attached'
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    kind: 'card_statement',
    title: `${source.institution} card statement`,
    summary: summary || null,
    data,
  };
};
