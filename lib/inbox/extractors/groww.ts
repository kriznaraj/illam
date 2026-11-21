import type { Extractor } from './types';
import { extractInvestmentStatement } from './investmentStatement';
import { extractNotice } from './notice';

/**
 * Groww (noreply@groww.in) sends statements, order confirmations and marketing from
 * one address. A statement — by its subject, or by carrying a PDF — is recorded as an
 * investment statement for the PDF pipeline; everything else is a notice, so an order
 * or an offer can never be mistaken for a holding or an expense.
 */
const STATEMENT_SUBJECT = /\b(?:statement|holdings?\s+report|capital\s+gains?|portfolio\s+report|account\s+summary)\b/i;

export const extractGroww: Extractor = (source, input) => {
  const hasPdf = input.attachmentNames.some((name) => /\.pdf$/i.test(name));
  return STATEMENT_SUBJECT.test(input.subject) || hasPdf ? extractInvestmentStatement(source, input) : extractNotice(source, input);
};
