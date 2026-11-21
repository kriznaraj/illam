import { describe, it, expect } from 'vitest';
import { describeActionBy, gmailLink, itemIdentity, itemState, todoGroup } from '../display';
import { buildCardIndex } from '@/lib/expenses/paymentSource';
import type { InboxItem, InboxTransactionData } from '@/types';

const CARDS = buildCardIndex([
  { last4: '5179', name: 'Rewards card - 5179' },
  { last4: '1515', name: 'HDFC Rupay - Bob - 1515' },
]);

const txn = (data: Partial<InboxTransactionData>, item: Partial<InboxItem> = {}): InboxItem =>
  ({
    id: 'item-1',
    owner: 'bob',
    kind: 'transaction',
    title: data.merchant ?? 'Payment',
    summary: null,
    status: 'new',
    needs_attention: false,
    attention_reason: null,
    action_by: null,
    consumed: null,
    attachment_names: [],
    received_at: '2026-09-19T08:00:00Z',
    data: {
      kind: 'transaction',
      bank: 'HDFC Bank',
      amount: 340.25,
      currency: 'INR',
      direction: 'debit',
      instrument: 'upi',
      last4: '1515',
      merchant: null,
      txnDate: '2026-09-19',
      available: null,
      outcome: 'success',
      international: false,
      ...data,
    },
    ...item,
  }) as InboxItem;

describe('gmailLink', () => {
  // The first version put the encoded address in the /mail/u/<account>/ path.
  // Gmail read "%40" as an unknown account and showed "Temporary Error (404)".
  it('selects the account with authuser, never an encoded path segment', () => {
    const link = gmailLink('someone@gmail.com', '19ecec6b0e10583b');
    expect(link).toBe('https://mail.google.com/mail/?authuser=someone%40gmail.com#all/19ecec6b0e10583b');
    expect(link).not.toContain('/mail/u/');
  });
});

describe('describeActionBy', () => {
  const TODAY = '2026-09-14';

  it.each([
    ['2026-09-12', 'Overdue by 2 days', 'danger'],
    ['2026-09-13', 'Overdue by 1 day', 'danger'],
    ['2026-09-14', 'Due today', 'danger'],
    ['2026-09-15', 'Due in 1 day', 'warning'],
    ['2026-09-17', 'Due in 3 days', 'warning'],
    ['2026-09-23', 'Due 23 Sep 2026', 'info'],
  ])('describes %s', (actionBy, label, tone) => {
    expect(describeActionBy(actionBy, TODAY)).toEqual({ label, tone });
  });

  it('returns null when there is no date', () => {
    expect(describeActionBy(null, TODAY)).toBeNull();
  });
});

describe('itemIdentity', () => {
  it('leads with the payee when the alert names one', () => {
    const identity = itemIdentity(txn({ merchant: 'BALAALICEN ENTERPRISES' }), CARDS);
    expect(identity.headline).toBe('BALAALICEN ENTERPRISES');
    expect(identity.method).toBe('HDFC Rupay - Bob ••1515');
    expect(identity.anonymous).toBe(false);
  });

  /*
   * 130 of the 346 live transaction alerts have no payee, so 109 rows read "Payment" and
   * were told apart only by their amount. ••1515 is the most-used method in the data.
   */
  it('names the card rather than saying "Payment" when there is no payee', () => {
    const identity = itemIdentity(txn({ merchant: null }), CARDS);
    expect(identity.headline).toBe('HDFC Rupay - Bob ••1515');
    expect(identity.method).toBeNull();
    expect(identity.anonymous).toBe(true);
  });

  it('refuses a payee that is really an alert footer', () => {
    const identity = itemIdentity(
      txn({ merchant: 'all times. If you have not done above transaction, please i…' }),
      CARDS
    );
    expect(identity.headline).toBe('HDFC Rupay - Bob ••1515');
    expect(identity.anonymous).toBe(true);
  });

  // ••1303 is an HDFC bank account recorded nowhere in Selvam. It still has a rail and digits.
  it('keeps the rail when Selvam knows no such card', () => {
    expect(itemIdentity(txn({ merchant: null, last4: '1303' }), CARDS).headline).toBe('HDFC UPI ••1303');
  });

  // "HDFC" alone names a bank the household holds seven cards and two accounts at.
  it('keeps the instrument when the alert quoted no digits', () => {
    expect(itemIdentity(txn({ merchant: null, last4: null }), CARDS).headline).toBe('HDFC UPI');
  });

  it('says "Money received" only when there is nothing else at all', () => {
    const identity = itemIdentity(txn({ merchant: null, direction: 'credit', last4: null, instrument: null, bank: '' }), CARDS);
    expect(identity.headline).toBe('Money received');
  });
});

describe('itemState', () => {
  it('calls an unclassified transfer open and a classified one settled', () => {
    const item = txn({}, { consumed: { action: 'transfer', at: '2026-09-19T08:00:00Z' } });
    expect(itemState(item, true)).toEqual({ label: 'Needs classifying', tone: 'open' });
    expect(itemState(item, false)).toEqual({ label: 'Transfer logged', tone: 'settled' });
  });

  it('has nothing to say about an alert automation has not reached', () => {
    expect(itemState(txn({}), false)).toBeNull();
  });
});

describe('todoGroup', () => {
  it('groups by the question being asked, not by the kind of mail', () => {
    expect(todoGroup(txn({}), true)).toBe('transfer');
    expect(todoGroup(txn({}), false)).toBe('alert');
    expect(todoGroup({ ...txn({}), kind: 'card_statement' } as InboxItem, false)).toBe('bill');
    expect(
      todoGroup({ ...txn({}), consumed: { action: 'statement_unread', at: 'x' } } as InboxItem, false)
    ).toBe('statement');
  });
});
