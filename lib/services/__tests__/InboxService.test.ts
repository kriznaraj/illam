import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InboxIngestMessage, InboxItem } from '@/types';

const { repo } = vi.hoisted(() => ({
  repo: {
    upsertByMessage: vi.fn(),
    list: vi.fn(),
    countOpenWork: vi.fn(),
    listFlaggedStatementItems: vi.fn(),
    update: vi.fn(),
    updateItem: vi.fn(),
  },
}));
const expenses = vi.hoisted(() => ({ findById: vi.fn(), delete: vi.fn(), findUndecidedInboxItemIds: vi.fn() }));
const transfers = vi.hoisted(() => ({ list: vi.fn() }));
const statements = vi.hoisted(() => ({ listSince: vi.fn() }));

vi.mock('@/lib/repositories/CreditCardStatementRepository', () => ({
  CreditCardStatementRepository: class {
    constructor() {
      return statements as any;
    }
  },
}));

vi.mock('@/lib/repositories/TransferRepository', () => ({
  TransferRepository: class {
    constructor() {
      return transfers as any;
    }
  },
}));

vi.mock('@/lib/repositories/ExpenseRepository', () => ({
  ExpenseRepository: class {
    constructor() {
      return expenses as any;
    }
  },
}));

vi.mock('@/lib/repositories/InboxRepository', () => ({
  InboxRepository: class {
    constructor() {
      return repo as any;
    }
  },
  TODO_FROM: '2026-09-01T00:00:00+05:30',
}));

import { InboxService } from '../InboxService';
import { EXTRACTOR_VERSION } from '@/lib/inbox/extractors';

const TODAY = '2026-09-14';
const ITEM_ID = '123e4567-e89b-12d3-a456-426614174000';

const message = (over: Partial<InboxIngestMessage> = {}): InboxIngestMessage => ({
  messageId: '18f2a3b4c5d6e7f8',
  mailbox: 'Alice@Example.com',
  from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.bank.in>',
  subject: 'Alert : Update on your HDFC Bank Credit Card',
  date: '2026-09-12T14:45:10.000Z',
  body: 'Dear Card Member, Rs.12,477.14 is debited from your HDFC Bank Credit Card ending 1234 towards CROMA on 12 Sep, 2026 at 20:15:10.',
  attachmentNames: [],
  ...over,
});

const lastRow = () => repo.upsertByMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;

let service: InboxService;

beforeEach(() => {
  vi.clearAllMocks();
  repo.upsertByMessage.mockImplementation(async (row: Record<string, unknown>) => ({
    id: ITEM_ID,
    status: 'new',
    consumed: null,
    created_at: '2026-09-12T14:46:00Z',
    updated_at: '2026-09-12T14:46:00Z',
    ...row,
  }));
  service = new InboxService({} as any);
});

describe('InboxService.ingest HTML-only mail', () => {
  it('reads the text of an HTML-only mail instead of storing markup', async () => {
    await service.ingest(
      'bob',
      message({
        from: 'Groww <noreply@groww.in>',
        subject: 'Edit SIP amount & date: Requested successfully',
        body: '<!doctype html><html><head><style>p{}</style></head><body><p>Your SIP of Rs 5,000 has been updated.</p></body></html>',
      }),
      TODAY
    );
    expect(lastRow().kind).toBe('notice');
    expect(String(lastRow().summary)).not.toContain('<');
    expect(String(lastRow().summary)).toContain('Rs 5,000');
  });
});

describe('InboxService.ingest re-reads', () => {
  const reminder = message({
    from: 'ICICI Bank <cards@icici.bank.in>',
    subject: 'Amazon through Standing Instruction YaLzJYDL2w is due',
    body: 'Dear Customer, your payment of INR 300.04 towards Amazon through Standing Instruction YaLzJYDL2w is due on 13/09/2026.',
  });
  const storedAs = (consumed: unknown) =>
    repo.upsertByMessage.mockImplementation(async (row: Record<string, unknown>) => ({
      id: ITEM_ID,
      status: 'new',
      created_at: '2026-09-11T00:00:00Z',
      updated_at: '2026-09-14T00:00:00Z',
      ...row,
      consumed,
    }));

  it('deletes the unconfirmed expense an alert auto-added once a re-read shows it moved no money', async () => {
    storedAs({ action: 'created', expense_id: 'exp-1', at: '2026-09-14T09:19:14Z' });
    expenses.findById.mockResolvedValue({ id: 'exp-1', needs_review: true, source: 'inbox', inbox_item_id: ITEM_ID });

    await service.ingest('alice', reminder, TODAY);

    expect(lastRow().kind).toBe('notice');
    expect(expenses.delete).toHaveBeenCalledWith('exp-1');
    expect(repo.updateItem).toHaveBeenCalledWith(ITEM_ID, { consumed: null });
  });

  it('keeps an expense someone has confirmed', async () => {
    storedAs({ action: 'created', expense_id: 'exp-1', at: '2026-09-14T09:19:14Z' });
    expenses.findById.mockResolvedValue({ id: 'exp-1', needs_review: false, source: 'inbox', inbox_item_id: ITEM_ID });

    await service.ingest('alice', reminder, TODAY);

    expect(expenses.delete).not.toHaveBeenCalled();
    expect(repo.updateItem).not.toHaveBeenCalled();
  });

  /*
   * Extractor v6 reads Axis's two-column alerts. 31 of 46 had no payee and became expenses
   * described "Axis Bank card ••2303 payment" — nothing for the category matcher, so all of
   * them landed in Miscellaneous. `created` is not a redecidable action, so the alert would be
   * fixed by a re-read while the expense it made stayed wrong.
   */
  const axisTwoColumn = message({
    subject: 'Transaction alert on Axis Bank Credit Card',
    from: 'Axis Bank Alerts <alerts@axisbank.com>',
    body: `A transaction has been charged to your card.

Transaction Amount:
INR 289
Merchant Name:
SRI SWEETS
Axis Bank Credit Card No.:
XX0001`,
  });

  it('rebuilds an auto-added expense once a re-read finally names the payee', async () => {
    storedAs({ action: 'created', expense_id: 'exp-1', at: '2026-09-19T09:00:00Z' });
    expenses.findById.mockResolvedValue({ id: 'exp-1', needs_review: true, source: 'inbox', inbox_item_id: ITEM_ID, merchant: null });

    await service.ingest('alice', axisTwoColumn, TODAY);

    expect(lastRow()).toMatchObject({ title: 'SRI SWEETS' });
    expect(expenses.delete).toHaveBeenCalledWith('exp-1');
    expect(repo.updateItem).toHaveBeenCalledWith(ITEM_ID, { consumed: null });
  });

  it('leaves the expense alone when the re-read names the same payee', async () => {
    // The script re-sends a 90-day window every run; an ordinary re-sync must not churn rows.
    storedAs({ action: 'created', expense_id: 'exp-1', at: '2026-09-19T09:00:00Z' });
    expenses.findById.mockResolvedValue({ id: 'exp-1', needs_review: true, source: 'inbox', inbox_item_id: ITEM_ID, merchant: 'SRI SWEETS' });

    await service.ingest('alice', axisTwoColumn, TODAY);

    expect(expenses.delete).not.toHaveBeenCalled();
  });

  it('never rebuilds an expense someone has already confirmed', async () => {
    storedAs({ action: 'created', expense_id: 'exp-1', at: '2026-09-19T09:00:00Z' });
    expenses.findById.mockResolvedValue({ id: 'exp-1', needs_review: false, source: 'inbox', inbox_item_id: ITEM_ID, merchant: null });

    await service.ingest('alice', axisTwoColumn, TODAY);

    expect(expenses.delete).not.toHaveBeenCalled();
  });

  it('lets automation decide again on an alert it had only ignored', async () => {
    storedAs({ action: 'ignored', reason: 'credit', at: '2026-09-14T04:54:09Z' });
    await service.ingest('alice', message(), TODAY);
    expect(repo.updateItem).toHaveBeenCalledWith(ITEM_ID, { consumed: null });
  });
});

describe('InboxService.ingest', () => {
  it('stores the extracted details and attention, but not the body', async () => {
    const result = await service.ingest('alice', message(), TODAY);

    expect(result.status).toBe('stored');
    const row = lastRow();
    expect(row).toMatchObject({
      owner: 'alice',
      mailbox: 'alice@example.com',
      gmail_message_id: '18f2a3b4c5d6e7f8',
      received_at: '2026-09-12T14:45:10.000Z',
      from_address: 'alerts@hdfcbank.bank.in',
      source: 'hdfc_alerts',
      kind: 'transaction',
      title: 'CROMA',
      needs_attention: true,
      attention_reason: 'Large debit',
      extractor: 'bank_alert',
      extractor_version: EXTRACTOR_VERSION,
    });
    expect(row.data).toMatchObject({ amount: 12477.14, last4: '1234' });
    expect(JSON.stringify(row)).not.toContain('Dear Card Member');
  });

  // Re-delivery must never undo a user's "done": the upsert leaves status to the column default.
  it('never sends status or consumed, so re-ingesting keeps what the user decided', async () => {
    await service.ingest('alice', message(), TODAY);
    const row = lastRow();
    expect('status' in row).toBe(false);
    expect('consumed' in row).toBe(false);
  });

  it('judges freshness on the Asia/Kolkata calendar day, not the UTC one', async () => {
    // 2026-09-06T19:00Z is 00:30 on 7 Sep in IST — exactly 7 days before TODAY, so still fresh.
    await service.ingest('alice', message({ date: '2026-09-06T19:00:00.000Z' }), TODAY);
    expect(lastRow().needs_attention).toBe(true);

    await service.ingest('alice', message({ date: '2026-09-06T18:00:00.000Z' }), TODAY);
    expect(lastRow().needs_attention).toBe(false);
  });

  it('ignores senders that are not configured, without writing', async () => {
    const result = await service.ingest('bob', message({ from: 'Newsletter <news@example.com>' }), TODAY);
    expect(result).toEqual({ status: 'ignored', reason: 'unknown_sender' });
    expect(repo.upsertByMessage).not.toHaveBeenCalled();
  });

  it('drops OTP mail even from a known sender, without writing', async () => {
    const result = await service.ingest(
      'alice',
      message({ subject: 'OTP for transaction', body: 'Your OTP is 482913 for Rs.12,477.14 at CROMA.' }),
      TODAY
    );
    expect(result).toEqual({ status: 'ignored', reason: 'sensitive' });
    expect(repo.upsertByMessage).not.toHaveBeenCalled();
  });

  it('redacts attachment names', async () => {
    await service.ingest(
      'alice',
      message({
        from: 'eCAS@cdslstatement.com',
        subject: 'CDSL Consolidated Account Statement',
        body: 'Please find attached.',
        attachmentNames: ['CAS_ABCDE1234F_082026.pdf'],
      }),
      TODAY
    );
    expect(lastRow().attachment_names).toEqual(['CAS_[PAN]_082026.pdf']);
  });

  it('rejects malformed messages before doing anything', async () => {
    await expect(service.ingest('alice', message({ messageId: '../../etc' }), TODAY)).rejects.toThrow('messageId');
    await expect(service.ingest('alice', message({ date: 'yesterday' }), TODAY)).rejects.toThrow('date must be a valid date');
    await expect(service.ingest('alice', message({ from: '' }), TODAY)).rejects.toThrow('from is required');
    expect(repo.upsertByMessage).not.toHaveBeenCalled();
  });
});

describe('InboxService.list', () => {
  beforeEach(() => {
    transfers.list.mockResolvedValue([]);
    expenses.findUndecidedInboxItemIds.mockResolvedValue([]);
    repo.listFlaggedStatementItems.mockResolvedValue([]);
    statements.listSince.mockResolvedValue({ data: [], error: null });
    repo.countOpenWork.mockResolvedValue(0);
  });

  it('returns a cursor only when the page is full', async () => {
    const items = [{ received_at: '2026-09-12T10:00:00Z' }, { received_at: '2026-09-11T10:00:00Z' }] as InboxItem[];
    repo.list.mockResolvedValue(items);
    repo.countOpenWork.mockResolvedValue(3);

    await expect(service.list({ view: 'all', limit: 2 })).resolves.toEqual({
      items,
      attentionCount: 3,
      nextCursor: '2026-09-11T10:00:00Z',
    });
    await expect(service.list({ view: 'all', limit: 5 })).resolves.toMatchObject({ nextCursor: null });
  });

  /*
   * The whole point of the To-do view. `inbox_items` cannot see that a transfer is still
   * `needs_review` — the flag it used to be filtered on is written once at ingest behind a
   * 7-day gate, so 14 of the 24 open transfers on 2026-09-27 were in no view at all.
   */
  it('hands the repository the alerts behind unclassified transfers', async () => {
    repo.list.mockResolvedValue([]);
    transfers.list.mockResolvedValue([
      { inbox_item_id: 'item-a', date: '2026-08-01', note: null },
      { inbox_item_id: null, date: '2026-08-01', note: null },
      { inbox_item_id: 'item-b', date: '2026-08-01', note: null },
    ]);

    await service.list({ view: 'todo', limit: 50 });

    expect(transfers.list).toHaveBeenCalledWith({ status: 'needs_review', limit: 500 });
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ openItemIds: ['item-a', 'item-b'] }));
    // The badge and the view are counted from the same list, so they cannot disagree.
    expect(repo.countOpenWork).toHaveBeenCalledWith(
      expect.objectContaining({ openItemIds: ['item-a', 'item-b'], settledItemIds: [] }),
      undefined
    );
  });

  // An anonymous NEFT names nobody, but next month's statement will. Until it has had its
  // chance, the transfer is waiting on evidence, not on a person.
  it('leaves out a transfer whose bank statement has not arrived yet', async () => {
    repo.list.mockResolvedValue([]);
    const thisMonth = new Date().toISOString().slice(0, 7);
    transfers.list.mockResolvedValue([
      { inbox_item_id: 'item-waiting', date: `${thisMonth}-01`, note: 'Account transfer (NEFT/IMPS)' },
      { inbox_item_id: 'item-read', date: `${thisMonth}-01`, note: 'Statement: NEFT DR-ACME' },
      { inbox_item_id: 'item-old', date: '2026-08-01', note: null },
    ]);

    await service.list({ view: 'todo', limit: 50 });

    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ openItemIds: ['item-read', 'item-old'] }));
  });

  // The user, 2026-10-03: "only conflicts need review". A spend filed under Dining Out from
  // the payee's history is not a question; one stuck in Miscellaneous is.
  it('adds the alerts behind expenses automation could not place, from September on', async () => {
    repo.list.mockResolvedValue([]);
    transfers.list.mockResolvedValue([{ inbox_item_id: 'item-a', date: '2026-08-01', note: null }]);
    expenses.findUndecidedInboxItemIds.mockResolvedValue(['item-misc']);

    await service.list({ view: 'todo', limit: 50 });

    expect(expenses.findUndecidedInboxItemIds).toHaveBeenCalledWith('2026-09-01');
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ openItemIds: ['item-a', 'item-misc'] }));
  });

  // Axis ₹3,933 was paid on time and still sat in the To-do as "Card bill due".
  it('drops a card bill that has been paid', async () => {
    repo.list.mockResolvedValue([]);
    repo.listFlaggedStatementItems.mockResolvedValue([
      { id: 'item-paid', statementId: 'st-paid' },
      { id: 'item-owed', statementId: 'st-owed' },
    ]);
    statements.listSince.mockResolvedValue({
      data: [
        { id: 'st-paid', statement_amount: 3933, amount_paid: 3933 },
        { id: 'st-owed', statement_amount: 20826, amount_paid: 0 },
      ],
      error: null,
    });

    await service.list({ view: 'todo', limit: 50 });

    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ settledItemIds: ['item-paid'] }));
  });

  it('still lists the inbox when the transfer lookup fails', async () => {
    repo.list.mockResolvedValue([]);
    transfers.list.mockRejectedValue(new Error('Gateway Timeout'));

    await expect(service.list({ view: 'todo', limit: 50 })).resolves.toMatchObject({ items: [] });
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ openItemIds: [] }));
  });

  // A link on /home, a bookmark, or a page served from the PWA cache still asks for these.
  it.each([
    ['attention', 'todo'],
    ['transactions', 'money'],
    ['cards', 'statements'],
    ['investments', 'statements'],
  ])('resolves the old view name %s to %s', async (requested, resolved) => {
    repo.list.mockResolvedValue([]);
    await service.list({ view: requested as any, limit: 50 });
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ view: resolved }));
  });

  it('rejects unknown views', async () => {
    await expect(service.list({ view: 'spam' as any })).rejects.toThrow('view must be one of');
  });
});

describe('InboxService.setStatus', () => {
  it('updates only the status', async () => {
    repo.update.mockResolvedValue({ id: ITEM_ID, status: 'done' });
    await service.setStatus(ITEM_ID, 'done');
    expect(repo.update).toHaveBeenCalledWith(ITEM_ID, { status: 'done' });
  });

  it('rejects bad ids and statuses', async () => {
    await expect(service.setStatus('nope', 'done')).rejects.toThrow('id must be a valid UUID');
    await expect(service.setStatus(ITEM_ID, 'archived' as any)).rejects.toThrow('status must be one of');
    expect(repo.update).not.toHaveBeenCalled();
  });
});
