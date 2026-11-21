import type { Extractor } from './types';
import { extractBankAlert } from './bankAlert';
import { extractCardStatement } from './cardStatement';

/**
 * For a sender that mixes card statements and transaction alerts on one address
 * (ICICI's cards@icici.bank.in). A statement is recognised by its subject, or by
 * a PDF plus statement wording in the body; everything else is read as an alert,
 * which itself falls back to a notice when it holds no transaction.
 */
const STATEMENT_SUBJECT = /\b(?:e-?)?statement\b/i;
const STATEMENT_BODY = /\bstatement\b.{0,80}\b(?:attached|enclosed|generated|ready)\b|\btotal\s+amount\s+due\b|\bpayment\s+due\s+date\b/i;

export const extractCardMixed: Extractor = (source, input) => {
  const hasPdf = input.attachmentNames.some((name) => /\.pdf$/i.test(name));
  const isStatement = STATEMENT_SUBJECT.test(input.subject) || (hasPdf && STATEMENT_BODY.test(input.body));
  return isStatement ? extractCardStatement(source, input) : extractBankAlert(source, input);
};
