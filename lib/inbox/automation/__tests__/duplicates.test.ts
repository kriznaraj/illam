import { describe, it, expect } from 'vitest';
import { findTwinAlert } from '../duplicates';
import type { InboxItem } from '@/types';

const alert = (id: string, gmail: string, receivedAt: string, over: Record<string, unknown> = {}, item: Partial<InboxItem> = {}) =>
  ({
    id,
    owner: 'alice',
    source: 'icici_card_statement',
    gmail_message_id: gmail,
    received_at: receivedAt,
    data: {
      kind: 'transaction',
      bank: 'ICICI Bank',
      amount: 5699.95,
      currency: 'INR',
      direction: 'debit',
      instrument: 'card',
      last4: '4123',
      merchant: 'AMAZON PAY IN E COMMERCE',
      txnDate: '2026-08-23',
      available: null,
      outcome: 'success',
      international: false,
      ...over,
    },
    ...item,
  }) as unknown as InboxItem;

// The real pair of 2026-08-23: two Gmail messages, the same second.
const first = alert('a', '1a02fd83127dc3bb', '2026-08-23T18:16:43Z');
const second = alert('b', '1a02fd84d905ab9b', '2026-08-23T18:16:43Z');

describe('findTwinAlert', () => {
  it('treats the later copy of a double-sent alert as the duplicate, and only that one', () => {
    expect(findTwinAlert(second, [first, second])?.id).toBe('a');
    expect(findTwinAlert(first, [first, second])).toBeNull();
  });

  it('keeps alerts that differ in amount, card, merchant, owner or time', () => {
    const pool = [
      alert('c', '1', '2026-08-23T18:16:00Z', { amount: 100 }),
      alert('d', '2', '2026-08-23T18:16:00Z', { last4: '1111' }),
      alert('e', '3', '2026-08-23T18:16:00Z', { merchant: 'SWIGGY' }),
      alert('f', '4', '2026-08-23T18:16:00Z', {}, { owner: 'bob' }),
      alert('g', '5', '2026-08-23T18:10:00Z'),
    ];
    expect(findTwinAlert(second, pool)).toBeNull();
  });
});
