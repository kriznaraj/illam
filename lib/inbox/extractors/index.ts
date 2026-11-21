import type { InboxExtractorId, InboxSource } from '../sources';
import type { Extracted, Extractor, ExtractorInput } from './types';
import { extractBankAlert } from './bankAlert';
import { extractCardStatement } from './cardStatement';
import { extractCardMixed } from './cardMixed';
import { extractAccountStatement } from './accountStatement';
import { extractIndmoney } from './indmoney';
import { extractInvestmentStatement } from './investmentStatement';
import { extractGroww } from './groww';

export type { Extracted, ExtractorInput } from './types';
export { detectNoticeKeywords } from './notice';

/**
 * Bump when an extractor's output changes meaningfully, so rows written by an
 * older version can be found (`extractor_version`) and re-read from Gmail.
 */
export const EXTRACTOR_VERSION = 7;

const EXTRACTORS: Record<InboxExtractorId, Extractor> = {
  bank_alert: extractBankAlert,
  card_statement: extractCardStatement,
  card_mixed: extractCardMixed,
  account_statement: extractAccountStatement,
  investment_statement: extractInvestmentStatement,
  indmoney: extractIndmoney,
  groww: extractGroww,
};

export function extractMessage(source: InboxSource, input: ExtractorInput): Extracted {
  return EXTRACTORS[source.extractor](source, input);
}
