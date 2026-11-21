import { describe, it, expect } from 'vitest';
import { createSupabaseMock } from './supabaseMock';
import { InboxRepository, type InboxItemWrite } from '../InboxRepository';

const row = {
  owner: 'alice',
  gmail_message_id: '18f2a3b4c5d6e7f8',
  title: 'CROMA',
} as unknown as InboxItemWrite;

describe('InboxRepository.upsertByMessage', () => {
  it('upserts on the Gmail message, sending exactly the given columns', async () => {
    const mock = createSupabaseMock({ data: { id: 'item-1' }, error: null });
    await new InboxRepository(mock.client).upsertByMessage(row);

    expect(mock.argsFor('upsert')).toEqual([[row, { onConflict: 'owner,gmail_message_id' }]]);
  });

  it('surfaces write errors', async () => {
    const mock = createSupabaseMock({ data: null, error: { message: 'duplicate key' } });
    await expect(new InboxRepository(mock.client).upsertByMessage(row)).rejects.toThrow('Failed to save inbox item');
  });
});

describe('InboxRepository.list', () => {
  it('builds the To-do view from open work, not from the stored flag alone', async () => {
    const mock = createSupabaseMock({ data: [], error: null });
    await new InboxRepository(mock.client).list({
      view: 'todo',
      owner: 'bob',
      limit: 3,
      openItemIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      today: '2026-10-18',
    });

    // The point of the view: an alert whose transfer is still `needs_review` is in it even
    // though `needs_attention` aged out. 14 of 24 such transfers were unreachable before.
    expect(mock.argsFor('or')).toEqual([
      [
        // A card bill only once overdue; notices are Heads-up, never To-do (the user, 2026-10-18).
        'and(needs_attention.eq.true,kind.eq.card_statement,data->>dueDate.lt.2026-10-18),consumed->>action.eq.statement_unread,' +
          'and(needs_attention.eq.true,kind.eq.notice,attention_reason.like.Statement says*),' +
          'id.in.(11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222)',
      ],
    ]);
    // Nothing before September (the user, 2026-10-03: "ignore all older").
    expect(mock.argsFor('gte')).toEqual([['received_at', '2026-09-01T00:00:00+05:30']]);
    expect(mock.argsFor('eq')).toEqual([
      ['status', 'new'],
      ['owner', 'bob'],
    ]);
    expect(mock.argsFor('limit')).toEqual([[3]]);
  });

  it('still finds flagged and unread-statement items when no transfer is open', async () => {
    const mock = createSupabaseMock({ data: [], error: null });
    await new InboxRepository(mock.client).list({ view: 'todo', limit: 50, openItemIds: [], today: '2026-10-18' });

    expect(mock.argsFor('or')).toEqual([
      [
        'and(needs_attention.eq.true,kind.eq.card_statement,data->>dueDate.lt.2026-10-18),consumed->>action.eq.statement_unread,' +
          'and(needs_attention.eq.true,kind.eq.notice,attention_reason.like.Statement says*)',
      ],
    ]);
    expect(mock.argsFor('not')).toEqual([]);
  });

  it('keeps work already settled elsewhere out of the To-do view', async () => {
    const mock = createSupabaseMock({ data: [], error: null });
    await new InboxRepository(mock.client).list({ view: 'todo', limit: 50, settledItemIds: ['item-paid'] });

    expect(mock.argsFor('not')).toEqual([['id', 'in', '(item-paid)']]);
  });

  it('lists fresh notices under Heads-up', async () => {
    const mock = createSupabaseMock({ data: [], error: null });
    await new InboxRepository(mock.client).list({ view: 'headsup', limit: 20 });

    expect(mock.argsFor('eq')).toEqual([
      ['status', 'new'],
      ['needs_attention', true],
      ['kind', 'notice'],
    ]);
  });

  it('hides dismissed items from the other views', async () => {
    const mock = createSupabaseMock({ data: [], error: null });
    await new InboxRepository(mock.client).list({ view: 'statements', limit: 50, before: '2026-09-01T00:00:00Z' });

    expect(mock.argsFor('in')).toEqual([['kind', ['card_statement', 'investment_statement']]]);
    expect(mock.argsFor('neq')).toEqual([['status', 'dismissed']]);
    expect(mock.argsFor('lt')).toEqual([['received_at', '2026-09-01T00:00:00Z']]);
  });

  it('keeps trades with the money that moved, not with the newsletters', async () => {
    const mock = createSupabaseMock({ data: [], error: null });
    await new InboxRepository(mock.client).list({ view: 'money', limit: 50 });

    expect(mock.argsFor('in')).toEqual([['kind', ['transaction', 'trade']]]);
  });

  it('retries a network blip', async () => {
    const mock = createSupabaseMock([
      { data: null, error: { message: 'TypeError: fetch failed' } },
      { data: [{ id: 'item-1' }], error: null },
    ]);
    await expect(new InboxRepository(mock.client).list({ view: 'all', limit: 50 })).resolves.toEqual([{ id: 'item-1' }]);
    expect(mock.awaitCount).toBe(2);
  });
});

describe('InboxRepository.updateItem', () => {
  // The first live statement run lost a recorded statement's item update to exactly this.
  it('retries a Supabase gateway timeout', async () => {
    const mock = createSupabaseMock([{ error: { message: 'Gateway Timeout' } }, { error: null }]);
    await new InboxRepository(mock.client).updateItem('item-1', { summary: 'Due 28 Sep 2026' });

    expect(mock.awaitCount).toBe(2);
    expect(mock.argsFor('eq')).toEqual([
      ['id', 'item-1'],
      ['id', 'item-1'],
    ]);
  });

  it('does not retry a real error', async () => {
    const mock = createSupabaseMock({ error: { message: 'column "summaryy" does not exist' } });
    await expect(new InboxRepository(mock.client).updateItem('item-1', { summary: 'x' })).rejects.toThrow('Failed to update inbox item');
    expect(mock.awaitCount).toBe(1);
  });
});
