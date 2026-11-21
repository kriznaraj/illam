import type { InboxTradeData, InboxTransactionData } from '@/types';
import type { Extractor } from './types';
import { extractInvestmentStatement } from './investmentStatement';
import { extractNotice } from './notice';
import { oneLine, parseAmountToken, truncate } from '../text';

/**
 * INDmoney US-stock mail. Written from the subject layout of real messages,
 * which carry everything that matters (amounts and companies illustrative):
 *   "BUY order of Example Corp. Class A for $100.00 is successful"
 *   "Buy order of Example Holdings Inc. Class A is cancelled"
 *   "SELL order of Sample Technology Inc. for $250.00 is successful"
 *   "🔔 Alice, Dividend Received: $1.23 from Example Corp …"
 * Statements become investment statements; anything else is a notice.
 */

const USD = '\\$\\s?([\\d,]*\\d(?:\\.\\d+)?)';

const ORDER = new RegExp(
  `\\b(buy|sell)\\s+order\\s+of\\s+(.+?)(?:\\s+for\\s+${USD})?\\s+is\\s+(successful|executed|completed|cancell?ed|rejected|failed)`,
  'i'
);
// The company name ends at the subject's end or at the layout pipe that starts the
// body's call to action: read against the subject alone first, because "… from Example
// Corp" with the body appended ran on to "Example Corp | Check Now View dividends
// from your US st…" — which is what the live rows are titled.
const DIVIDEND = new RegExp(`dividend\\s+received:?\\s*${USD}\\s+from\\s+(.+?)\\s*(?:[.!|]|$)`, 'i');

function outcomeOf(word: string): InboxTradeData['outcome'] {
  if (/^cancel/i.test(word)) return 'cancelled';
  if (/^(rejected|failed)$/i.test(word)) return 'failed';
  return 'success';
}

export const extractIndmoney: Extractor = (source, input) => {
  const subject = oneLine(input.subject);
  const text = `${subject} ${oneLine(input.body)}`;

  const order = text.match(ORDER);
  if (order) {
    const side = order[1].toLowerCase() === 'buy' ? 'buy' : 'sell';
    const name = truncate(order[2].trim(), 60);
    const data: InboxTradeData = {
      kind: 'trade',
      broker: source.institution,
      side,
      symbol: name,
      quantity: null,
      price: null,
      amount: order[3] ? parseAmountToken(order[3]) : null,
      currency: 'USD',
      outcome: outcomeOf(order[4]),
    };
    const verb = side === 'buy' ? 'Bought' : 'Sold';
    return {
      kind: 'trade',
      title: data.outcome === 'success' ? `${verb} ${name}` : `${side === 'buy' ? 'Buy' : 'Sell'} order ${data.outcome} · ${name}`,
      summary: `${source.institution} · US stocks`,
      data,
    };
  }

  const dividend = subject.match(DIVIDEND) ?? text.match(DIVIDEND);
  const dividendAmount = dividend ? parseAmountToken(dividend[1]) : null;
  if (dividend && dividendAmount !== null) {
    const data: InboxTransactionData = {
      kind: 'transaction',
      bank: source.institution,
      amount: dividendAmount,
      currency: 'USD',
      direction: 'credit',
      instrument: null,
      last4: null,
      merchant: truncate(dividend[2].trim(), 60),
      txnDate: input.receivedDate,
      available: null,
      outcome: 'success',
      // A dividend is paid in USD by design; it is not a card spend abroad.
      international: false,
      // Said outright by the mail, so automation records it as income without asking.
      purpose: 'dividend',
    };
    return {
      kind: 'transaction',
      title: `Dividend · ${data.merchant}`,
      summary: `Credit · ${source.institution} US stocks`,
      data,
    };
  }

  if (/\bstatement\b/i.test(subject)) return extractInvestmentStatement(source, input);
  return extractNotice(source, input);
};
