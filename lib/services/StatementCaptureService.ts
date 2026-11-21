import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { StatementRecordService, type CardStatementOutcome } from './StatementRecordService';
import { CasImportService, type CasApplyOutcome } from './CasImportService';
import { StatementBalanceService, type BalanceApplyOutcome, type BalanceResult, type BalanceStatement } from './StatementBalanceService';
import { CreditCardStatementService } from './CreditCardStatementService';
import { TransferStatementService } from './TransferStatementService';
import { StatementIncomeService } from './StatementIncomeService';
import { CommitmentService } from './CommitmentService';
import { INCOME_KIND_LABEL } from './IncomeService';
import { StatementSampleRepository, type StatementSampleWrite } from '@/lib/repositories/StatementSampleRepository';
import { InboxRepository } from '@/lib/repositories/InboxRepository';
import { extractPdfText, type PdfTextResult } from '@/lib/statements/pdfText';
import { describeEncryption, describeEncryptionInfo, describeIntegrity, passwordShape } from '@/lib/statements/pdfDiagnostics';
import { statementPasswords } from '@/lib/statements/passwords';
import { passwordHint, redactStatementText } from '@/lib/statements/samples';
import { parseAxisCardStatement, parseHdfcCardStatement, parseIciciCardStatement, type ParsedCardStatement } from '@/lib/statements/cardStatements';
import { parseCdslCas } from '@/lib/statements/cdslCas';
import { parseHdfcAccountStatement, parseKotakAccountStatement, type ParsedAccountStatement } from '@/lib/statements/accountStatements';
import { parseNpsStatement } from '@/lib/statements/npsStatement';
import { otherMemberNames } from '@/lib/household';
import { formatMoney } from '@/lib/inbox/display';
import { formatters } from '@/lib/utils/dateUtils';
import { redact, truncate } from '@/lib/inbox/text';
import type { InboxCasRead, InboxData, InboxIngestAttachment, InboxOwner, Transfer } from '@/types';

/** Two months of one statement type show what varies between issues. */
export const MAX_SAMPLES_PER_SOURCE = 2;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

/**
 * Sources with a statement reader, written against real captured layouts.
 * Their statements become records on every ingest; other sources
 * are only sampled, while capture is switched on.
 */
export const CARD_STATEMENT_PARSERS: Partial<Record<string, (text: string) => ParsedCardStatement>> = {
  hdfc_card_statement: parseHdfcCardStatement,
  axis_card_statement: parseAxisCardStatement,
  icici_card_statement: parseIciciCardStatement,
};

/**
 * Sources whose statement is read into holdings: the totals go on the Madal item, and
 * a statement that reconciles is applied to its owner's Selvam accounts
 * (CasImportService).
 */
const CAS_SOURCES: ReadonlySet<string> = new Set(['cdsl_cas']);

const fromAccountStatement = (parsed: ParsedAccountStatement): BalanceStatement => ({
  periodTo: parsed.periodTo,
  balances: parsed.accounts.map(({ last4, closing, reconciled, lines, linesReconciled }) => ({
    last4,
    closing,
    reconciled,
    // Lines that do not step from opening to closing are not evidence for anything.
    ...(linesReconciled ? { lines } : {}),
  })),
});

/**
 * Sources whose statement prints month-end balances — bank accounts and NPS,
 * written against real captured layouts. Each becomes the snapshot of
 * the account the member's `statementAccounts` maps it to (StatementBalanceService).
 */
export const BALANCE_READERS: Partial<Record<string, (text: string) => BalanceStatement>> = {
  hdfc_account_statement: (text) => fromAccountStatement(parseHdfcAccountStatement(text)),
  kotak_account_statement: (text) => fromAccountStatement(parseKotakAccountStatement(text)),
  nps_protean: (text) => {
    const parsed = parseNpsStatement(text);
    return {
      periodTo: parsed.asOn,
      balances:
        parsed.pranLast4 && parsed.total !== null
          ? [{ last4: parsed.pranLast4, closing: parsed.total, reconciled: parsed.reconciled }]
          : [],
    };
  },
};

export function statementCaptureEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.INBOX_CAPTURE_STATEMENT_TEXT === '1';
}

export interface CaptureRequest {
  owner: InboxOwner;
  sourceId: string;
  inboxItemId: string;
  /** App-timezone date the email arrived; drives attention on the recorded statement. */
  receivedDate: string;
  /** The extractor's data for the item, which a statement read adds to rather than replaces. */
  extractedData?: InboxData;
  body: string;
  attachments: readonly InboxIngestAttachment[];
}

/** A statement with a reader that did not become a record, and why. */
export type StatementReadOutcome =
  | CardStatementOutcome
  | { status: 'unreadable'; reason: string }
  | { status: 'error'; message: string };

export interface StatementProcessResult {
  samples: StatementSampleWrite[];
  records: StatementReadOutcome[];
  cas?: InboxCasRead;
  casApply?: CasApplyOutcome;
  balances?: BalanceApplyOutcome | { status: 'unreadable'; reason: string };
}

const isPdf = (a: InboxIngestAttachment) => a.contentType === 'application/pdf' || /\.pdf$/i.test(a.name);

/**
 * Statement PDFs that arrive with an email: unlocked in memory, then
 *  - recorded, when the source has a reader (card statements → credit_card_statements);
 *  - sampled (TEMPORARY, migration 031), while INBOX_CAPTURE_STATEMENT_TEXT=1, so
 *    readers for the other sources can be written against their real layout.
 * A locked PDF is sampled without text, with the email's password hint.
 */
export class StatementCaptureService extends BaseService {
  private samples: StatementSampleRepository;
  private recorder: StatementRecordService;
  private inbox: InboxRepository;
  private casImport: CasImportService;
  private balances: StatementBalanceService;
  private cards: CreditCardStatementService;
  private transferStatements: TransferStatementService;
  private statementIncome: StatementIncomeService;
  private commitments: CommitmentService;

  constructor(supabase: SupabaseClient, private env: Record<string, string | undefined> = process.env) {
    super();
    this.samples = new StatementSampleRepository(supabase);
    this.recorder = new StatementRecordService(supabase);
    this.inbox = new InboxRepository(supabase);
    this.casImport = new CasImportService(supabase);
    this.balances = new StatementBalanceService(supabase);
    this.cards = new CreditCardStatementService(supabase);
    this.transferStatements = new TransferStatementService(supabase);
    this.statementIncome = new StatementIncomeService(supabase);
    this.commitments = new CommitmentService(supabase);
  }

  async capture(request: CaptureRequest): Promise<StatementProcessResult> {
    const result: StatementProcessResult = { samples: [], records: [] };

    const pdfs = request.attachments.filter(isPdf);
    if (pdfs.length === 0) return result;

    const parser = CARD_STATEMENT_PARSERS[request.sourceId];
    const readsCas = CAS_SOURCES.has(request.sourceId);
    const balanceReader = BALANCE_READERS[request.sourceId];
    const reads = !!parser || readsCas || !!balanceReader;
    const sampling = statementCaptureEnabled(this.env);
    if (!sampling && !reads) return result;

    let slots = sampling ? MAX_SAMPLES_PER_SOURCE - (await this.samples.countCaptured(request.sourceId, request.owner)) : 0;
    if (slots <= 0 && !reads) return result;

    const passwords = statementPasswords(request.owner, request.sourceId, this.env);
    const hint = passwordHint(request.body);

    for (const pdf of pdfs) {
      if (slots <= 0 && !reads) break;
      const bytes = Buffer.from(pdf.base64, 'base64');
      const extraction: PdfTextResult | null =
        bytes.length > 0 && bytes.length <= MAX_PDF_BYTES ? await extractPdfText(bytes, passwords) : null;

      if (sampling && slots > 0) {
        const row = this.sampleRow(request, pdf, bytes, extraction, passwords, hint);
        // A fresh timestamp on every save: an unchanged-looking row could otherwise be a
        // stale one from an earlier run, which is exactly what could not be told apart live.
        await this.samples.upsertSample({ ...row, created_at: new Date().toISOString() });
        result.samples.push(row);
        if (row.status === 'captured') slots -= 1;
      }

      if (parser) {
        result.records.push(await this.record(request, parser, extraction, bytes.length));
      }
      if (readsCas && extraction?.status === 'ok') {
        const { read, applied } = await this.readCas(request, extraction.text);
        result.cas = read;
        result.casApply = applied;
      }
      if (balanceReader) {
        result.balances = await this.readBalances(request, balanceReader, extraction, bytes.length);
      }
    }

    this.log(
      'StatementCaptureService.capture',
      `${request.sourceId}: samples ${result.samples.map((r) => r.status).join(', ') || 'none'}; records ${result.records.map((r) => r.status).join(', ') || 'none'}`
    );
    return result;
  }

  /**
   * Read one statement into its record. Anything short of a record is kept on the
   * inbox item (`statement_unread` + reason), so a statement that silently failed
   * to record can be told apart from one that was never tried.
   */
  private async record(
    request: CaptureRequest,
    parser: (text: string) => ParsedCardStatement,
    extraction: PdfTextResult | null,
    size: number
  ): Promise<StatementReadOutcome> {
    let outcome: StatementReadOutcome;
    if (!extraction) {
      outcome = { status: 'unreadable', reason: `unexpected size ${size} bytes` };
    } else if (extraction.status === 'locked') {
      outcome = { status: 'unreadable', reason: extraction.reason };
    } else if (extraction.status === 'failed') {
      outcome = { status: 'unreadable', reason: truncate(extraction.error, 200) };
    } else {
      try {
        const parsed = parser(extraction.text);
        outcome = await this.recorder.recordCardStatement(parsed, {
          id: request.inboxItemId,
          receivedDate: request.receivedDate,
          owner: request.owner,
        });
        if ('accountId' in outcome && parsed.statementDate) {
          await this.syncCardSnapshot(outcome.accountId, parsed.statementDate.slice(0, 7));
        }
      } catch (error) {
        outcome = { status: 'error', message: truncate(error instanceof Error ? error.message : String(error), 200) };
      }
    }

    const reason =
      outcome.status === 'unreadable'
        ? outcome.reason
        : outcome.status === 'error'
          ? `error: ${outcome.message}`
          : outcome.status === 'incomplete'
            ? `could not find ${outcome.missing.join(', ')}`
            : null;
    if (reason) {
      await this.inbox.updateItem(request.inboxItemId, {
        consumed: { action: 'statement_unread', reason, at: new Date().toISOString() },
      });
    }
    return outcome;
  }

  /**
   * A recorded statement is that card's balance for the month — the same write the
   * "Sync all" button on /portfolio/snapshots makes, which until now was the only way
   * a card balance reached Selvam. Best-effort: the statement is already recorded,
   * and the button still repairs a miss.
   */
  private async syncCardSnapshot(accountId: string, month: string): Promise<void> {
    try {
      await this.cards.syncSnapshotForMonth(accountId, month);
    } catch (error) {
      this.warn('StatementCaptureService.syncCardSnapshot', `${accountId} ${month}`, error instanceof Error ? error.message : error);
    }
  }

  /**
   * Read a statement's month-end balances, apply the mapped ones to Selvam, and say
   * on the Madal item what was read and what became of each account.
   */
  private async readBalances(
    request: CaptureRequest,
    reader: (text: string) => BalanceStatement,
    extraction: PdfTextResult | null,
    size: number
  ): Promise<BalanceApplyOutcome | { status: 'unreadable'; reason: string }> {
    const at = new Date().toISOString();
    const unread = async (reason: string) => {
      await this.inbox.updateItem(request.inboxItemId, { consumed: { action: 'statement_unread', reason, at } });
      return { status: 'unreadable' as const, reason };
    };

    if (!extraction) return unread(`unexpected size ${size} bytes`);
    if (extraction.status === 'locked') return unread(extraction.reason);
    if (extraction.status === 'failed') return unread(truncate(extraction.error, 200));

    let statement: BalanceStatement;
    let applied: BalanceApplyOutcome;
    try {
      statement = reader(extraction.text);
      if (statement.balances.length === 0) return unread('no balance found in the statement');
      applied = await this.balances.apply(request.owner, request.sourceId, statement);
    } catch (error) {
      return unread(`error: ${truncate(error instanceof Error ? error.message : String(error), 200)}`);
    }
    if (applied.status === 'not_month_end') {
      return unread(`statement ends ${applied.periodTo ?? 'on an unknown date'}, not on a month end`);
    }

    const { results, snapshotDate } = applied;
    // Before the transfers: a waiting credit that is salary is filed as income, and a waiting
    // debit that is a premium or an EMI is claimed by its commitment, not read as anything else.
    const flows = await this.readMoneyFlows(request, statement);
    const { settled, refiled, contradicted } = await this.settleTransfers(request.owner, statement);
    // A filed transfer the statement proves went to the other person is refiled (with undo); only
    // one that could not be refiled is left for Madal's To-do.
    const contradiction =
      contradicted.length > 0
        ? `Statement says ${contradicted.map((t) => `${formatMoney(Number(t.amount), 'INR')} on ${formatters.toFullDate(t.date)}`).join(', ')} went to ${otherMemberNames(request.owner)} — filed as ${Array.from(new Set(contradicted.map((t) => t.kind.replace('_', ' ')))).join(', ')}`
        : null;
    const appliedAny = results.some((r) => r.status === 'applied');
    const problems = results.filter((r) => r.status === 'not_reconciled' || r.status === 'failed');
    const unmapped = results.filter((r) => r.status === 'unmapped');
    const reason =
      [
        problems.length > 0 ? problems.map(balanceProblem).join('; ') : null,
        unmapped.length > 0 ? `no Selvam account for ${unmapped.map((r) => `••${r.last4}`).join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('; ') || undefined;

    // A statement read in full is recorded even when none of its accounts is in Selvam;
    // only one that could not be trusted (or not written) is left to be looked at.
    const consumed =
      appliedAny || problems.length === 0
        ? { action: 'statement_recorded' as const, ...(appliedAny ? { snapshot_date: snapshotDate } : {}), ...(reason ? { reason } : {}), at }
        : { action: 'statement_unread' as const, reason, at };

    const extracted = request.extractedData?.kind === 'investment_statement' ? request.extractedData : null;
    const total = statement.balances.length === 1 ? statement.balances[0].closing : null;
    await this.inbox.updateItem(request.inboxItemId, {
      ...(extracted ? { data: { ...extracted, periodTo: statement.periodTo ?? extracted.periodTo, amount: total ?? extracted.amount } } : {}),
      summary: [
        ...results.map(balanceLabel),
        statement.periodTo ? `as on ${formatters.toFullDate(statement.periodTo)}` : null,
        appliedAny ? `Selvam updated for ${formatters.toFullDate(snapshotDate)}` : null,
        settled > 0 ? `${settled} transfer${settled === 1 ? '' : 's'} settled from the statement` : null,
        refiled.length > 0
          ? `${refiled.length} transfer${refiled.length === 1 ? '' : 's'} refiled as household (${refiled.map((t) => formatMoney(Number(t.amount), 'INR')).join(', ')})`
          : null,
        ...flows,
      ]
        .filter(Boolean)
        .join(' · '),
      consumed,
      // The ingest upsert has already rewritten the flag; only a refile that failed raises it again.
      ...(contradiction ? { needs_attention: true, attention_reason: truncate(contradiction, 300) } : {}),
    });
    return applied;
  }

  /**
   * Money in and commitments, read off the statement's lines (migration 037): salary, interest
   * and dividends become income; a premium or EMI is recorded against its commitment. Returns
   * what to say on the Madal item. Best-effort: the balances are already applied.
   */
  private async readMoneyFlows(request: CaptureRequest, statement: BalanceStatement): Promise<string[]> {
    const accounts = statement.balances.flatMap((b) => (b.lines ? [{ last4: b.last4, lines: b.lines }] : []));
    if (accounts.length === 0) return [];
    const bank = /^kotak/.test(request.sourceId) ? 'Kotak' : /^hdfc/.test(request.sourceId) ? 'HDFC' : request.sourceId;
    const said: string[] = [];
    try {
      const income = await this.statementIncome.record(request.owner, request.sourceId, bank, accounts);
      const byKind = new Map<string, number>();
      for (const row of income.recorded) byKind.set(INCOME_KIND_LABEL[row.kind], (byKind.get(INCOME_KIND_LABEL[row.kind]) ?? 0) + row.amount);
      if (byKind.size > 0) said.push(`Income read: ${Array.from(byKind, ([kind, amount]) => `${kind} ${formatMoney(amount, 'INR')}`).join(', ')}`);
    } catch (error) {
      this.warn('StatementCaptureService.readMoneyFlows', 'income', error instanceof Error ? error.message : error);
    }
    try {
      const paid = (await this.commitments.recordFromStatement(request.owner, accounts)).filter((p) => p.created);
      if (paid.length > 0) said.push(`Paid: ${paid.map((p) => `${p.commitment.name} ${formatMoney(Number(p.payment.amount), 'INR')}`).join(', ')}`);
    } catch (error) {
      this.warn('StatementCaptureService.readMoneyFlows', 'commitments', error instanceof Error ? error.message : error);
    }
    return said;
  }

  /**
   * The statement names the other side of every NEFT its alerts left anonymous; waiting
   * transfers are matched to its lines and settled where the narration decides them.
   * Best-effort: the balances are already applied, and a failure leaves transfers waiting.
   */
  private async settleTransfers(
    owner: InboxOwner,
    statement: BalanceStatement
  ): Promise<{ settled: number; refiled: Transfer[]; contradicted: Transfer[] }> {
    const accounts = statement.balances.flatMap((b) => (b.lines ? [{ last4: b.last4, lines: b.lines }] : []));
    if (accounts.length === 0) return { settled: 0, refiled: [], contradicted: [] };
    try {
      const outcome = await this.transferStatements.settleFromStatement(owner, accounts);
      return { settled: outcome.settled + outcome.recorded, refiled: outcome.refiled, contradicted: outcome.contradicted };
    } catch (error) {
      this.warn('StatementCaptureService.settleTransfers', owner, error instanceof Error ? error.message : error);
      return { settled: 0, refiled: [], contradicted: [] };
    }
  }

  /**
   * Read a CAS, apply it to Selvam when it reconciles, and put the totals — never the
   * holdings — and what happened on the Madal item.
   */
  private async readCas(request: CaptureRequest, text: string): Promise<{ read: InboxCasRead; applied: CasApplyOutcome }> {
    const parsed = parseCdslCas(text);
    const total = (rows: { value: number }[]) => Math.round(rows.reduce((sum, row) => sum + row.value, 0) * 100) / 100;
    const read: InboxCasRead = {
      asOn: parsed.asOn,
      total: parsed.summary.total,
      dematRows: parsed.demat.length,
      dematValue: total(parsed.demat),
      dematExpected: parsed.summary.demat,
      folioRows: parsed.folios.length,
      folioValue: total(parsed.folios),
      folioExpected: parsed.summary.mfFolios,
      unreadRows: parsed.unreadRows,
      reconciled: parsed.reconciled.demat && parsed.reconciled.folios,
    };

    let applied: CasApplyOutcome;
    try {
      applied = await this.casImport.apply(request.owner, parsed);
    } catch (error) {
      applied = { status: 'failed', message: truncate(error instanceof Error ? error.message : String(error), 200) };
    }
    const at = new Date().toISOString();
    const consumed =
      applied.status === 'applied'
        ? { action: 'statement_recorded' as const, snapshot_date: applied.snapshotDate, at }
        : applied.status === 'partial'
          ? {
              action: 'statement_recorded' as const,
              snapshot_date: applied.snapshotDate,
              reason: `folios not applied — no single account lists: ${applied.unassignedFolios.join('; ')}`.slice(0, 500),
              at,
            }
        : applied.status === 'not_reconciled'
          ? { action: 'statement_unread' as const, reason: `holdings do not add up to the statement (${read.unreadRows} row(s) unread)`, at }
          : applied.status === 'failed'
            ? { action: 'statement_unread' as const, reason: `error: ${applied.message}`, at }
            : null;

    const extracted = request.extractedData?.kind === 'investment_statement' ? request.extractedData : null;
    await this.inbox.updateItem(request.inboxItemId, {
      data: {
        kind: 'investment_statement',
        provider: 'cdsl',
        periodFrom: extracted?.periodFrom ?? null,
        periodTo: parsed.asOn ?? extracted?.periodTo ?? null,
        amount: parsed.summary.total ?? extracted?.amount ?? null,
        hasAttachment: true,
        cas: read,
      },
      summary: [
        parsed.summary.total !== null ? `Portfolio ${formatMoney(parsed.summary.total, 'INR')}` : null,
        parsed.asOn ? `as on ${formatters.toFullDate(parsed.asOn)}` : null,
        applied.status === 'applied'
          ? `Selvam updated for ${formatters.toFullDate(applied.snapshotDate)}`
          : applied.status === 'partial'
            ? `Stocks updated for ${formatters.toFullDate(applied.snapshotDate)}, ${applied.unassignedFolios.length} folio(s) need an account`
          : read.reconciled
            ? 'all holdings read'
            : `${read.unreadRows} holding row(s) unread`,
      ]
        .filter(Boolean)
        .join(' · '),
      ...(consumed ? { consumed } : {}),
      // A folio no fund list names holds back every folio; the user adds the fund to a list.
      ...(applied.status === 'partial' ? { needs_attention: true, attention_reason: 'CAS folio not in any fund list' } : {}),
    });
    return { read, applied };
  }

  private sampleRow(
    request: CaptureRequest,
    pdf: InboxIngestAttachment,
    bytes: Buffer,
    extraction: PdfTextResult | null,
    passwords: string[],
    hint: string | null
  ): StatementSampleWrite {
    const base = {
      owner: request.owner,
      source: request.sourceId,
      inbox_item_id: request.inboxItemId,
      attachment_name: truncate(redact(pdf.name), 120),
      password_hint: hint,
    };
    if (!extraction) {
      return { ...base, status: 'failed', detail: `unexpected size ${bytes.length} bytes`, page_count: null, text: null };
    }

    // Encryption type, file integrity and candidate shapes (never values) say whether a
    // lock is a wrong password, a damaged file or an unreadable handler.
    const encryption = describeEncryptionInfo(describeEncryption(bytes));
    const integrity = describeIntegrity(bytes);
    // Emails often show the password's tail ("PAN : ******978J"); say whether each
    // candidate ends with it, which reveals nothing the email did not.
    const visibleTail = hint?.match(/\*{3,}\s*([A-Z0-9]{3,4})\b/)?.[1] ?? null;
    const tried =
      passwords.length > 0
        ? passwords
            .map((p) => `${passwordShape(p)}${visibleTail ? (p.toUpperCase().endsWith(visibleTail) ? ' tail✓' : ' tail✗') : ''}`)
            .join(', ')
        : 'none';
    const detail = (outcome: string) => truncate(`${outcome} · ${encryption} · ${integrity} · tried ${tried}`, 600);

    if (extraction.status === 'ok') {
      return {
        ...base,
        status: 'captured',
        detail: detail(`${extraction.passwordUsed ? 'unlocked' : 'not protected'} by ${extraction.engine}`),
        page_count: extraction.pageCount,
        text: redactStatementText(extraction.text),
      };
    }
    if (extraction.status === 'locked') {
      return {
        ...base,
        status: 'locked',
        detail: detail(extraction.readerErrors ? `${extraction.reason} [${extraction.readerErrors.join('; ')}]` : extraction.reason),
        page_count: null,
        text: null,
      };
    }
    return { ...base, status: 'failed', detail: detail(extraction.error), page_count: null, text: null };
  }
}

/** "••3101 ₹1,85,420.10" — one account of a balance statement, and what became of it. */
function balanceLabel(result: BalanceResult): string {
  if (result.status === 'failed') return `••${result.last4} not saved`;
  const amount = `••${result.last4} ${formatMoney(result.amount, 'INR')}`;
  return result.status === 'not_reconciled' ? `${amount} (does not add up)` : amount;
}

function balanceProblem(result: BalanceResult): string {
  return result.status === 'failed'
    ? `••${result.last4}: ${truncate(result.message, 120)}`
    : `••${result.last4}: opening, credits and debits do not add up to the closing balance`;
}
