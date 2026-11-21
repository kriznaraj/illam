// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestPdf } from '@/lib/statements/__tests__/testPdf';

const repo = vi.hoisted(() => ({ countCaptured: vi.fn(), upsertSample: vi.fn() }));
const recorder = vi.hoisted(() => ({ recordCardStatement: vi.fn() }));
const inbox = vi.hoisted(() => ({ updateItem: vi.fn() }));
const casImport = vi.hoisted(() => ({ apply: vi.fn() }));
const balances = vi.hoisted(() => ({ apply: vi.fn() }));
const cards = vi.hoisted(() => ({ syncSnapshotForMonth: vi.fn() }));

vi.mock('../StatementBalanceService', () => ({
  StatementBalanceService: class {
    constructor() {
      return balances as any;
    }
  },
}));

vi.mock('../CreditCardStatementService', () => ({
  CreditCardStatementService: class {
    constructor() {
      return cards as any;
    }
  },
}));

vi.mock('../CasImportService', () => ({
  CasImportService: class {
    constructor() {
      return casImport as any;
    }
  },
}));

vi.mock('@/lib/repositories/InboxRepository', () => ({
  InboxRepository: class {
    constructor() {
      return inbox as any;
    }
  },
}));

vi.mock('../StatementRecordService', () => ({
  StatementRecordService: class {
    constructor() {
      return recorder as any;
    }
  },
}));

vi.mock('@/lib/repositories/StatementSampleRepository', () => ({
  StatementSampleRepository: class {
    constructor() {
      return repo as any;
    }
  },
}));

import { StatementCaptureService } from '../StatementCaptureService';
import { formatters } from '@/lib/utils/dateUtils';

const CAS_LINES = ['CONSOLIDATED ACCOUNT STATEMENT', 'PAN ABCDE1234F', 'HOLDING STATEMENT AS ON 31-08-2026'];
const BODY = 'Please find attached your CAS. The password to open the statement is your PAN in upper case.';

const pdf = (password?: string, name = 'AUG2026_AA12348519_TXN.pdf') => ({
  name,
  contentType: 'application/pdf',
  base64: buildTestPdf(CAS_LINES, password).toString('base64'),
});

const request = (attachments = [pdf('ABCDE1234F')]) => ({
  owner: 'alice' as const,
  sourceId: 'cdsl_cas',
  inboxItemId: 'item-1',
  receivedDate: '2026-09-10',
  body: BODY,
  attachments,
});

const enabledEnv = {
  INBOX_CAPTURE_STATEMENT_TEXT: '1',
  STATEMENT_PASSWORDS_ALICE: JSON.stringify({ cdsl_cas: ['ABCDE1234F'] }),
};

beforeEach(() => {
  vi.clearAllMocks();
  repo.countCaptured.mockResolvedValue(0);
  repo.upsertSample.mockResolvedValue(undefined);
  inbox.updateItem.mockResolvedValue({});
  casImport.apply.mockResolvedValue({ status: 'applied', snapshotDate: '2026-07-01', dematTotal: 65054.1, folioTotal: 0, holdingsCreated: 0 });
});

describe('StatementCaptureService.capture', () => {
  it('does nothing for a source without a reader unless capture is switched on', async () => {
    const service = new StatementCaptureService({} as any, { STATEMENT_PASSWORDS_ALICE: enabledEnv.STATEMENT_PASSWORDS_ALICE });
    expect(await service.capture({ ...request(), sourceId: 'groww' })).toEqual({ samples: [], records: [] });
    expect(repo.countCaptured).not.toHaveBeenCalled();
    expect(repo.upsertSample).not.toHaveBeenCalled();
  });

  it('unlocks the PDF and stores masked text, never the password', async () => {
    const service = new StatementCaptureService({} as any, enabledEnv);
    await service.capture(request());

    const row = repo.upsertSample.mock.calls[0][0];
    expect(row).toMatchObject({
      owner: 'alice',
      source: 'cdsl_cas',
      inbox_item_id: 'item-1',
      status: 'captured',
      detail: expect.stringMatching(/^unlocked by pdfjs-1\.10 · Standard V1 R2 · \d+b %PDF-1\.4 EOF ID · tried 10ch A9$/),
      page_count: 1,
      password_hint: 'The password to open the statement is your PAN in upper case.',
    });
    expect(row.text).toContain('HOLDING STATEMENT AS ON 31-08-2026');
    expect(row.text).toContain('PAN [PAN]');
    expect(row.attachment_name).toBe('AUG2026_AA••8519_TXN.pdf');
    expect(JSON.stringify(row)).not.toContain('ABCDE1234F');
  });

  it('records a locked PDF, with the hint, when no password works', async () => {
    const service = new StatementCaptureService({} as any, { INBOX_CAPTURE_STATEMENT_TEXT: '1' });
    await service.capture(request());

    expect(repo.upsertSample).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'locked',
        detail: expect.stringMatching(/^password_required · Standard V1 R2 · \d+b %PDF-1\.4 EOF ID · tried none$/),
        text: null,
        password_hint: expect.stringContaining('PAN'),
      })
    );
  });

  it('stops once a statement type has enough samples', async () => {
    repo.countCaptured.mockResolvedValue(2);
    const service = new StatementCaptureService({} as any, enabledEnv);
    expect(await service.capture({ ...request(), sourceId: 'groww' })).toEqual({ samples: [], records: [] });
    expect(repo.upsertSample).not.toHaveBeenCalled();
  });

  // Card statements with a reader become records on every ingest — capture on or off.
  it('records a card statement through its reader even when sampling is off', async () => {
    recorder.recordCardStatement.mockResolvedValue({ status: 'created', statementId: 'st-1', accountId: 'acc-1' });
    const hdfcLines = [
      'TOTAL AMOUNT DUE',
      'C31,861.08',
      'MINIMUM DUE',
      'C1,600.00',
      'DUE DATE',
      '28 Jul, 2026',
      'Credit Card No.',
      'Alternate Account Number',
      'Statement Date',
      'Billing Period',
      'CKYC ID',
      '526873XXXXXX9999',
      '08 Jul, 2026',
      '09 Jun, 2026 - 08 Jul, 2026',
    ];
    const service = new StatementCaptureService({} as any, {
      STATEMENT_PASSWORDS_ALICE: JSON.stringify({ hdfc_card_statement: ['ALIC0101'] }),
    });

    const result = await service.capture({
      ...request([{ name: '526873XXXXXX9999_08-07-2026.pdf', contentType: 'application/pdf', base64: buildTestPdf(hdfcLines, 'ALIC0101').toString('base64') }]),
      sourceId: 'hdfc_card_statement',
    });

    expect(repo.countCaptured).not.toHaveBeenCalled();
    expect(repo.upsertSample).not.toHaveBeenCalled();
    expect(recorder.recordCardStatement).toHaveBeenCalledWith(
      expect.objectContaining({ bank: 'HDFC Bank', last4: '9999', totalDue: 31861.08, dueDate: '2026-07-28', statementDate: '2026-07-08' }),
      { id: 'item-1', receivedDate: '2026-09-10', owner: 'alice' }
    );
    expect(result).toEqual({ samples: [], records: [{ status: 'created', statementId: 'st-1', accountId: 'acc-1' }] });
    // The recorded statement is the card's balance for its month — no button press needed.
    expect(cards.syncSnapshotForMonth).toHaveBeenCalledWith('acc-1', '2026-07');
  });

  describe('a card statement that does not become a record', () => {
    const HDFC_LINES = ['TOTAL AMOUNT DUE', 'C410.00', 'DUE DATE', '28 Jul, 2026'];
    const hdfcRequest = (password: string) => ({
      ...request([{ name: 'statement.pdf', contentType: 'application/pdf', base64: buildTestPdf(HDFC_LINES, password).toString('base64') }]),
      sourceId: 'hdfc_card_statement',
    });
    const env = { STATEMENT_PASSWORDS_ALICE: JSON.stringify({ hdfc_card_statement: ['ALIC0101'] }) };

    it('keeps the reason on the item when the PDF will not open', async () => {
      const result = await new StatementCaptureService({} as any, env).capture(hdfcRequest('OTHER999'));

      expect(recorder.recordCardStatement).not.toHaveBeenCalled();
      expect(result.records).toEqual([{ status: 'unreadable', reason: 'password_incorrect' }]);
      expect(inbox.updateItem).toHaveBeenCalledWith('item-1', {
        consumed: expect.objectContaining({ action: 'statement_unread', reason: 'password_incorrect' }),
      });
    });

    it('keeps the fields it could not find', async () => {
      recorder.recordCardStatement.mockResolvedValue({ status: 'incomplete', missing: ['statementDate'] });
      await new StatementCaptureService({} as any, env).capture(hdfcRequest('ALIC0101'));

      expect(inbox.updateItem).toHaveBeenCalledWith('item-1', {
        consumed: expect.objectContaining({ action: 'statement_unread', reason: 'could not find statementDate' }),
      });
    });

    it('keeps a recording error rather than losing it to a log line', async () => {
      recorder.recordCardStatement.mockRejectedValue(new Error('Failed to load statements: timeout'));
      const result = await new StatementCaptureService({} as any, env).capture(hdfcRequest('ALIC0101'));

      expect(result.records).toEqual([{ status: 'error', message: 'Failed to load statements: timeout' }]);
      expect(inbox.updateItem).toHaveBeenCalledWith('item-1', {
        consumed: expect.objectContaining({ action: 'statement_unread', reason: 'error: Failed to load statements: timeout' }),
      });
    });

    it('leaves the item alone once it is recorded', async () => {
      recorder.recordCardStatement.mockResolvedValue({ status: 'unchanged', statementId: 'st-1', accountId: 'acc-1' });
      await new StatementCaptureService({} as any, env).capture(hdfcRequest('ALIC0101'));
      expect(inbox.updateItem).not.toHaveBeenCalled();
    });
  });

  it('reads a CAS, applies it to Selvam, and puts the totals and the outcome on its Madal item', async () => {
    const casLines = [
      'Asset ClassValuePercentage',
      'Equity',
      '65,054.10100.00',
      'Total',
      '65,054.10100.00',
      'HOLDING STATEMENT AS ON 30-06-2026',
      'INE000A01011',
      'TEST MOTORS LIMITED - EQUITY SHARES',
      '6.000------6.00010842.350065,054.10',
      'Portfolio Value 65,054.10 as on 30-06-2026',
    ];
    const service = new StatementCaptureService({} as any, {
      STATEMENT_PASSWORDS_ALICE: JSON.stringify({ cdsl_cas: ['ABCDE1234F'] }),
    });

    const result = await service.capture({
      ...request([{ name: 'JUN2026_AA12348519_TXN.pdf', contentType: 'application/pdf', base64: buildTestPdf(casLines, 'ABCDE1234F').toString('base64') }]),
      extractedData: { kind: 'investment_statement', provider: 'cdsl', periodFrom: '2026-06-01', periodTo: null, amount: null, hasAttachment: true },
    });

    const cas = { asOn: '2026-06-30', total: 65054.1, dematRows: 1, dematValue: 65054.1, dematExpected: 65054.1, folioRows: 0, folioValue: 0, folioExpected: null, unreadRows: 0, reconciled: true };
    expect(result.cas).toEqual(cas);
    expect(result.casApply).toMatchObject({ status: 'applied', snapshotDate: '2026-07-01' });
    expect(casImport.apply).toHaveBeenCalledWith('alice', expect.objectContaining({ asOn: '2026-06-30', reconciled: { demat: true, folios: true } }));
    expect(recorder.recordCardStatement).not.toHaveBeenCalled();
    expect(repo.upsertSample).not.toHaveBeenCalled();
    expect(inbox.updateItem).toHaveBeenCalledWith('item-1', {
      data: { kind: 'investment_statement', provider: 'cdsl', periodFrom: '2026-06-01', periodTo: '2026-06-30', amount: 65054.1, hasAttachment: true, cas },
      summary: `Portfolio ₹65,054.10 · as on 30 Jun 2026 · Selvam updated for ${formatters.toFullDate('2026-07-01')}`,
      consumed: { action: 'statement_recorded', snapshot_date: '2026-07-01', at: expect.any(String) },
    });
  });

  it('keeps an unreconciled CAS off Selvam and says why on its item', async () => {
    casImport.apply.mockResolvedValue({ status: 'not_reconciled' });
    const lines = ['HOLDING STATEMENT AS ON 30-06-2026', 'INE000A01011', 'TEST MOTORS LIMITED', '6.000------6.00010942.350065,054.10'];
    const service = new StatementCaptureService({} as any, {
      STATEMENT_PASSWORDS_ALICE: JSON.stringify({ cdsl_cas: ['ABCDE1234F'] }),
    });

    await service.capture(request([{ name: 'JUN2026.pdf', contentType: 'application/pdf', base64: buildTestPdf(lines, 'ABCDE1234F').toString('base64') }]));

    expect(inbox.updateItem).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({
        summary: expect.stringContaining('1 holding row(s) unread'),
        consumed: expect.objectContaining({ action: 'statement_unread', reason: 'holdings do not add up to the statement (1 row(s) unread)' }),
      })
    );
  });

  describe('a balance statement (bank account, NPS)', () => {
    const KOTAK_LINES = [
      'Account Statement',
      '01 Jul 2026 - 31 Jul 2026',
      'Account No. 7311111505',
      'Account Summary',
      'Savings Account (SA):40,000.0039,000.00',
      'ActivMoney (AM):1,35,000.001,47,000.00',
      'Total Balance (SA + AM):1,75,000.001,86,000.00',
    ];
    const kotakRequest = (password = 'BOBB0101') => ({
      ...request([{ name: '73XXXXX111.pdf', contentType: 'application/pdf', base64: buildTestPdf(KOTAK_LINES, password).toString('base64') }]),
      owner: 'bob' as const,
      sourceId: 'kotak_account_statement',
    });
    const env = { STATEMENT_PASSWORDS_BOB: JSON.stringify({ kotak_account_statement: ['BOBB0101'] }) };

    it('applies the month-end balance and says so on the item', async () => {
      balances.apply.mockResolvedValue({
        status: 'done',
        snapshotDate: '2026-08-01',
        results: [{ last4: '1505', status: 'applied', accountId: 'acc-kotak', amount: 186000 }],
      });
      await new StatementCaptureService({} as any, env).capture(kotakRequest());

      expect(balances.apply).toHaveBeenCalledWith('bob', 'kotak_account_statement', {
        periodTo: '2026-07-31',
        balances: [{ last4: '1505', closing: 186000, reconciled: true }],
      });
      expect(inbox.updateItem).toHaveBeenCalledWith('item-1', {
        summary: `••1505 ₹1,86,000.00 · as on 31 Jul 2026 · Selvam updated for ${formatters.toFullDate('2026-08-01')}`,
        consumed: { action: 'statement_recorded', snapshot_date: '2026-08-01', at: expect.any(String) },
      });
    });

    it('records a statement read in full even when none of its accounts is in Selvam', async () => {
      balances.apply.mockResolvedValue({
        status: 'done',
        snapshotDate: '2026-08-01',
        results: [{ last4: '1505', status: 'unmapped', amount: 186000 }],
      });
      await new StatementCaptureService({} as any, env).capture(kotakRequest());

      expect(inbox.updateItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        consumed: { action: 'statement_recorded', reason: 'no Selvam account for ••1505', at: expect.any(String) },
      }));
    });

    it('leaves a balance that does not add up for a person to look at', async () => {
      balances.apply.mockResolvedValue({
        status: 'done',
        snapshotDate: '2026-08-01',
        results: [{ last4: '1505', status: 'not_reconciled', amount: 186000 }],
      });
      await new StatementCaptureService({} as any, env).capture(kotakRequest());

      expect(inbox.updateItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        consumed: expect.objectContaining({ action: 'statement_unread', reason: expect.stringContaining('do not add up') }),
      }));
    });

    it('keeps the reason on the item when the PDF will not open', async () => {
      const result = await new StatementCaptureService({} as any, env).capture(kotakRequest('OTHER999'));

      expect(balances.apply).not.toHaveBeenCalled();
      expect(result.balances).toEqual({ status: 'unreadable', reason: 'password_incorrect' });
      expect(inbox.updateItem).toHaveBeenCalledWith('item-1', {
        consumed: expect.objectContaining({ action: 'statement_unread', reason: 'password_incorrect' }),
      });
    });
  });

  it('ignores non-PDF attachments', async () => {
    const service = new StatementCaptureService({} as any, enabledEnv);
    await service.capture(request([{ name: 'tax_report.xlsx', contentType: 'application/vnd.ms-excel', base64: 'AAAA' }]));
    expect(repo.upsertSample).not.toHaveBeenCalled();
  });
});
