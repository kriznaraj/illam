export interface User {
  id: string;
  username: string;
  full_name: string;
  icon?: string;
  email: string | null;
  password_hash: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  group_name: string;
  icon?: string;
  budget: number | null;
  color: string;
  sort_order: number;
}

export interface Event {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
  color: string;
  is_active: boolean;
  family_tracker_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  user_id: string | null;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  date: string;
  amount: number;
  category_id: string;
  description: string;
  user_id: string;
  event_id: string | null;
  entered_by?: string; // Deprecated, kept for backward compatibility
  receipt_url: string | null;
  /** 'inbox' when created from a transaction alert. */
  source?: ExpenseSource;
  /** The alert that created or enriched this expense. */
  inbox_item_id?: string | null;
  /** e.g. "HDFC Bank UPI ••3101" — filled from the alert. */
  payment_method?: string | null;
  merchant?: string | null;
  /** Auto-added and not yet confirmed; excluded from totals and insights. */
  needs_review?: boolean;
  /** HH:mm:ss in Asia/Kolkata, when known. */
  spent_time?: string | null;
  /** spent_time is the alert's arrival time, not a time the bank printed. */
  spent_time_approx?: boolean;
  created_at: string;
  updated_at: string;
  category?: Category;
  user?: User;
  event?: Event;
  tags?: Tag[];
  expense_tags?: Array<{ tag: Tag }>; // Junction table data from joins
  tag_ids?: string[]; // For form submissions
}

export interface ExpenseWithCategory extends Expense {
  category: Category;
  user?: User;
  tags?: Tag[];
}

export interface PortfolioAccount {
  id: string;
  name: string;
  type: string;
  notes: string | null;
  currency: string;
  details: Record<string, unknown> | null;
  unit: string | null;
  multiplier: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  /**
   * Cash, outside the investment boundary. NULL/absent = decided by
   * type; read it through `isCashAccount` in `lib/portfolio/cashAccounts.ts`.
   */
  is_cash?: boolean | null;
}

export interface PortfolioAccountType {
  id: string;
  name: string;
  color: string;
  show_in_growth: boolean;
  is_equity: boolean;
  /**
   * Money owed rather than held (credit cards, loans). Snapshots for accounts of
   * this type are stored negative so that plain `sum(amount)` net-worth math stays
   * correct — see lib/portfolio/liabilities.ts.
   */
  is_liability?: boolean;
}

export interface PortfolioSnapshot {
  id: string;
  account_id: string;
  snapshot_date: string;
  amount: number;       // always the monetary value (units × price at time of entry)
  units: number | null; // raw unit count if account uses a multiplier
  created_at: string;
  account?: PortfolioAccount;
}

/** Instrument type; matches DB CHECK constraint on portfolio_holdings.instrument_type. */
export type PortfolioInstrumentType =
  | 'nse_stock'
  | 'bse_stock'
  | 'mf_nav'
  | 'us_stock'
  | 'gold_etf'
  | 'gold_physical'
  | 'gold_rate'
  | 'sgb'
  | 'bond'
  | 'nps'
  | 'manual';

export interface PortfolioHolding {
  id: string;
  account_id: string;
  name: string;
  symbol: string | null;
  identifier: string;
  instrument_type: PortfolioInstrumentType;
  quantity_unit: string | null;
  sort_order: number;
  details: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  account?: PortfolioAccount;
}

export interface PortfolioHoldingSnapshot {
  id: string;
  holding_id: string;
  snapshot_date: string;
  quantity: number;
  unit_amount: number | null;
  amount: number;
  created_at: string;
  holding?: PortfolioHolding;
}

export type PortfolioInvestmentKind = 'adhoc' | 'recurring';

export interface PortfolioInvestment {
  id: string;
  account_id: string;
  investment_date: string;
  amount: number;
  kind: PortfolioInvestmentKind;
  note: string | null;
  created_at: string;
  updated_at: string;
  account?: PortfolioAccount;
}

export interface PortfolioAccountMonthlyData {
  account: PortfolioAccount;
  monthlyBalances: { [month: string]: number | null };
  /** Months whose value was carried forward from the last real snapshot */
  carriedMonths: string[];
  latestBalance: number | null;
  growth: number | null;
  growthPercent: number | null;
}

export interface PortfolioReportData {
  months: string[];
  groupedData: {
    [typeName: string]: PortfolioAccountMonthlyData[];
  };
  monthlyTotals: { [month: string]: number };
  typeBalances: {
    [typeName: string]: {
      latestTotal: number;
      growth: number;
      growthPercent: number;
    };
  };
  grandTotal: number;
  currentTotal: number;
  overallGrowth: number;
  overallGrowthPercent: number;
}

export interface Note {
  id: string;
  user_id: string | null;
  title: string;
  content: string | null;
  tags: string[];
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Todo {
  id: string;
  user_id: string | null;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ActivityTrackerEventType = 'one_time' | 'activity' | 'annual';
export type ActivityTrackerStatus = 'open' | 'closed';

export interface ActivityTrackerEvent {
  id: string;
  series_id: string | null;
  title: string;
  description: string | null;
  event_type: ActivityTrackerEventType;
  event_date: string;
  status: ActivityTrackerStatus;
  reminder_days_before: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityTrackerOccurrence {
  id: string;
  event_id: string;
  occurred_at: string;
  comment: string | null;
  created_at: string;
}

export type ActivityTrackerFormData = {
  title: string;
  description?: string;
  event_type: ActivityTrackerEventType;
  event_date: string;
  reminder_days_before?: number;
};

// ---------------------------------------------------------------------------
// Insights (Selavu + Selvam)
//
// Single source of truth for the insight shape: InsightsService, lib/ai/schemas.ts
// and both insights pages all use it.
// ---------------------------------------------------------------------------

export type InsightSeverity = 'danger' | 'warning' | 'info' | 'success';

export type InsightType =
  | 'pattern'
  | 'anomaly'
  | 'trend'
  | 'achievement'
  | 'prediction'
  | 'projection'
  | 'performance'
  | 'diversification'
  | 'data_quality';

export interface Insight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  description: string;
  icon: string;
  /** Headline rupee figure. Nullable because the LLM schema returns null, not undefined. */
  value?: number | null;
  /** Percentage change. Same nullability caveat as `value`. */
  change?: number | null;
  action?: string | null;
  /**
   * Rupee magnitude of what this insight is about, used purely for ranking
   * within a severity band. Never rendered. Without it a ₹495 "Egg Spike"
   * could outrank a lakh-sized renovation simply by arriving first.
   */
  weight?: number;
}

/** Which engine produced a set of insights. `unknown` covers rows cached before this was recorded. */
export type InsightEngine = 'ai' | 'rules' | 'unknown';

// ---------------------------------------------------------------------------
// Inbox (Madal) — a focused feed of important mail from both Gmail accounts.
// Only extracted details are stored; the email body never is. `data` repeats
// `kind` so the union narrows on either field.
// ---------------------------------------------------------------------------

/** A household member's slug (lib/household.ts). */
export type InboxOwner = string;

export type InboxKind = 'transaction' | 'card_statement' | 'investment_statement' | 'trade' | 'notice';

export type InboxStatus = 'new' | 'done' | 'dismissed';

/**
 * The four questions Madal answers.
 *
 * `todo` is *derived*, not a stored flag — see `InboxRepository.list`. The view it replaced
 * read `needs_attention`, which is evaluated once at ingest behind a 7-day freshness gate,
 * so open work aged out of the view while staying open: most transfers awaiting
 * classification could become unreachable from it.
 */
export type InboxView = 'todo' | 'headsup' | 'money' | 'statements' | 'all';

export interface InboxTransactionData {
  kind: 'transaction';
  bank: string;
  amount: number;
  currency: string;
  direction: 'debit' | 'credit';
  instrument: 'card' | 'account' | 'upi' | null;
  last4: string | null;
  merchant: string | null;
  txnDate: string | null;
  /**
   * Clock time of the spend, HH:mm:ss, when the alert quotes one. It separates two same-day
   * spends at one merchant, and it is the context a person uses to recognise a payment they
   * half forgot. Absent on alerts that quote no time.
   */
  txnTime?: string | null;
  /** Balance or available card limit — whichever the alert quotes. */
  available: number | null;
  outcome: 'success' | 'declined';
  international: boolean;
  /**
   * What a credit *is*, when the mail says so outright. Only the INDmoney
   * dividend mail sets it today, and that is enough to record those without asking. Absent on
   * every row written before 2026-09-19, and on every credit whose purpose has to be guessed —
   * those wait in review instead.
   */
  purpose?: 'dividend';
}

export interface InboxCardStatementData {
  kind: 'card_statement';
  bank: string;
  last4: string | null;
  statementDate: string | null;
  totalDue: number | null;
  minDue: number | null;
  dueDate: string | null;
  passwordProtected: boolean;
}

export interface InboxInvestmentStatementData {
  kind: 'investment_statement';
  provider: 'cdsl' | 'nsdl' | 'nps' | 'indmoney' | 'groww' | 'zerodha';
  periodFrom: string | null;
  periodTo: string | null;
  amount: number | null;
  hasAttachment: boolean;
  /** Set once the attached CAS has been read (lib/statements/cdslCas.ts). */
  cas?: InboxCasRead;
}

/**
 * What the CAS reader made of an attached statement: totals only — never the
 * holdings, folios or PAN, since inbox_items is anon-readable. `reconciled` means
 * every section's rows add up to the statement's own total.
 */
export interface InboxCasRead {
  asOn: string | null;
  total: number | null;
  dematRows: number;
  dematValue: number;
  dematExpected: number | null;
  folioRows: number;
  folioValue: number;
  folioExpected: number | null;
  unreadRows: number;
  reconciled: boolean;
}

export interface InboxTradeData {
  kind: 'trade';
  broker: string;
  side: 'buy' | 'sell' | null;
  /** Ticker when the mail gives one, else the instrument name ("Alphabet Inc. Class A"). */
  symbol: string | null;
  quantity: number | null;
  price: number | null;
  /** Order value, when quoted. */
  amount: number | null;
  currency: string;
  outcome: 'success' | 'cancelled' | 'failed';
}

export interface InboxNoticeData {
  kind: 'notice';
  institution: string;
  keywords: string[];
  amount: number | null;
}

export type InboxData =
  | InboxTransactionData
  | InboxCardStatementData
  | InboxInvestmentStatementData
  | InboxTradeData
  | InboxNoticeData;

export interface InboxItem {
  id: string;
  owner: InboxOwner;
  mailbox: string;
  gmail_message_id: string;
  received_at: string;
  from_address: string;
  source: string;
  kind: InboxKind;
  title: string;
  summary: string | null;
  data: InboxData;
  attachment_names: string[];
  needs_attention: boolean;
  attention_reason: string | null;
  action_by: string | null;
  status: InboxStatus;
  extractor: string;
  extractor_version: number;
  consumed: InboxConsumed | null;
  created_at: string;
  updated_at: string;
}

/** One message as pushed by the Gmail Apps Script. */
export interface InboxIngestMessage {
  messageId: string;
  mailbox: string;
  from: string;
  subject: string;
  /** ISO timestamp the message was received. */
  date: string;
  /** Plain-text body. Read in memory for extraction, never stored. */
  body: string;
  attachmentNames?: string[];
  /** Only for statement senders (`attachments: true` in lib/inbox/sources.ts). */
  attachments?: InboxIngestAttachment[];
}

export interface InboxListResponse {
  items: InboxItem[];
  /**
   * How much is still waiting on a person — the size of the `todo` view, whatever view was
   * asked for. Derived, so it also covers transfers whose alert aged past the ingest-time
   * freshness gate.
   */
  attentionCount: number;
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Madal automation: expenses from alerts, transfers, payee rules.
// ---------------------------------------------------------------------------

/** 'inbox': from a transaction alert (030) · 'statement': from a card statement line (032). */
export type ExpenseSource = 'manual' | 'inbox' | 'statement';

export type StatementTransactionStatus = 'matched' | 'added' | 'unmatched' | 'ignored';

/** One line of a recorded card statement and how it reconciled. */
export interface StatementTransaction {
  id: string;
  statement_id: string;
  account_id: string;
  line_no: number;
  txn_date: string;
  description: string;
  merchant: string | null;
  amount: number;
  direction: 'debit' | 'credit';
  status: StatementTransactionStatus;
  expense_id: string | null;
  inbox_item_id: string | null;
  created_at: string;
  updated_at: string;
}

/** What automation did with an inbox item. Written once; an item with `consumed` set is never re-processed. */
export interface InboxConsumed {
  action:
    | 'linked'
    | 'created'
    | 'history_unmatched'
    | 'card_bill'
    | 'transfer'
    | 'income'
    | 'ignored'
    | 'statement_recorded'
    | 'statement_unread';
  expense_id?: string;
  transfer_id?: string;
  income_id?: string;
  statement_id?: string;
  /** The Selvam snapshot month an applied CAS wrote. */
  snapshot_date?: string;
  reason?: string;
  /** How an auto-added expense got its category — for auditing the AI step. */
  category_source?: CategorySource;
  at: string;
}

export type CategorySource = 'rule' | 'history' | 'keyword' | 'ai' | 'none';

// ---------------------------------------------------------------------------
// Income. Money in, kept out of `expenses` so no expense read
// has to learn about signs.
// ---------------------------------------------------------------------------

export type IncomeKind = 'salary' | 'dividend' | 'interest' | 'refund' | 'reimbursement' | 'rent' | 'gift' | 'other';

export interface Income {
  id: string;
  date: string;
  amount: number;
  /** Dividends arrive in USD inside the INDmoney wallet and are stored as paid. */
  currency: string;
  kind: IncomeKind;
  source_name: string | null;
  description: string | null;
  user_id: string;
  /** Set when the money landed inside a Selvam account rather than a bank account. */
  account_id: string | null;
  inbox_item_id: string | null;
  /** 'statement' when read off a bank statement line. */
  source: 'manual' | 'inbox' | 'statement';
  /** source:last4:date:amount:occurrence of the statement line it was read from; unique. */
  statement_ref?: string | null;
  needs_review: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncomeWithUser extends Income {
  user?: User;
}

// ---------------------------------------------------------------------------
// Commitments: insurance premiums, loan EMIs — declared once,
// never expenses, shown on /cash-flow in the months they fall due.
// ---------------------------------------------------------------------------

export type CommitmentKind = 'insurance' | 'loan' | 'other';
export type CommitmentFrequency = 'monthly' | 'quarterly' | 'half_yearly' | 'annual';

export interface Commitment {
  id: string;
  name: string;
  kind: CommitmentKind;
  amount: number;
  frequency: CommitmentFrequency;
  /** yyyy-MM — the first month it falls due; later due months step from it. */
  start_month: string;
  due_day: number;
  /** yyyy-MM — the last month it falls due; null runs on. */
  end_month: string | null;
  /** A fragment of how the bank prints the payee; a line or alert containing it is the payment. */
  match_text: string | null;
  account_id: string | null;
  note: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** What Madal decided on its own. */
export type MadalDecisionAction = 'classified' | 'refiled' | 'suggested' | 'categorised' | 'committed';

export interface MadalDecision {
  id: string;
  inbox_item_id: string | null;
  transfer_id: string | null;
  expense_id: string | null;
  decided_by: 'claude' | 'statement';
  action: MadalDecisionAction;
  /** The transfer kind (or category id, for 'categorised') decided or suggested. */
  kind: string | null;
  /** One line, for a person: why. */
  reason: string;
  /** The text the decision rests on — a statement line, a payee. */
  evidence: string | null;
  evidence_key: string | null;
  /** Everything needed to put it back. */
  before: Record<string, unknown>;
  model: string | null;
  created_at: string;
  undone_at: string | null;
}

export type CommitmentPaymentSource = 'statement' | 'alert' | 'manual';

export interface CommitmentPayment {
  id: string;
  commitment_id: string;
  /** yyyy-MM of the due month this pays. */
  due_month: string;
  paid_date: string;
  amount: number;
  source: CommitmentPaymentSource;
  inbox_item_id: string | null;
  transfer_id: string | null;
  /** yyyy-MM: paid ahead — also settles every later due month up to this one, at ₹0. */
  covers_through?: string | null;
  note: string | null;
  created_at: string;
}

/** paid: evidence seen · assumed: due date passed, no evidence yet (counted at the declared amount) · upcoming: not due yet. */
export type CommitmentDueStatus = 'paid' | 'assumed' | 'upcoming';

// ---------------------------------------------------------------------------
// Cash flow (/cash-flow): money in against every kind of money out.
// ---------------------------------------------------------------------------

export interface CashFlowLine {
  key: string;
  label: string;
  amount: number;
  detail?: string | null;
  status?: CommitmentDueStatus;
  /** yyyy-MM-dd, for a line that is one dated event. */
  date?: string | null;
}

export type CashFlowSectionKey = 'spending' | 'commitments' | 'investments' | 'tax' | 'other';

export interface CashFlowSection {
  key: CashFlowSectionKey;
  label: string;
  total: number;
  lines: CashFlowLine[];
}

export interface CashFlowMonth {
  month: string;
  moneyIn: number;
  moneyOut: number;
  net: number;
}

export interface CashFlowReport {
  /** yyyy-MM, inclusive. */
  from: string;
  to: string;
  months: string[];
  moneyIn: {
    total: number;
    lines: CashFlowLine[];
    /** Money received in another currency (INDmoney dividends, USD) — never added to rupees. */
    foreign: { currency: string; amount: number }[];
  };
  moneyOut: { total: number; sections: CashFlowSection[] };
  /** moneyIn − moneyOut. */
  net: number;
  /** net / moneyIn, when there was money in. */
  savingsRate: number | null;
  monthly: CashFlowMonth[];
  /** Commitments falling due in the next 90 days. */
  upcoming: CashFlowLine[];
  gaps: {
    /** Madal transfers nobody has classified yet — not in either total. */
    waitingTransfers: { count: number; debit: number; credit: number };
    /** Closed months in range with no salary read. */
    monthsWithoutSalary: string[];
    /** ATM withdrawals — not counted; what the cash bought is, when it is logged. */
    cashWithdrawn: number;
  };
}

export type TransferKind = 'own_account' | 'investment' | 'loan' | 'card_bill' | 'cash' | 'tax' | 'family' | 'other';

export type TransferStatus = 'needs_review' | 'confirmed';

export interface Transfer {
  id: string;
  inbox_item_id: string | null;
  owner: InboxOwner;
  date: string;
  amount: number;
  direction: 'debit' | 'credit';
  counterparty: string | null;
  payment_method: string | null;
  kind: TransferKind;
  account_id: string | null;
  portfolio_investment_id: string | null;
  credit_card_statement_id: string | null;
  expense_id: string | null;
  note: string | null;
  status: TransferStatus;
  /** Set when this debit is a virtual SIP instalment (details.funds[].name); no row is added. */
  sip_fund?: string | null;
  /** yyyy-MM of that instalment. */
  sip_month?: string | null;
  created_at: string;
  updated_at: string;
}

export type TransactionRuleAction = 'expense' | 'transfer' | 'ignore';

export interface TransactionRule {
  id: string;
  owner: InboxOwner | null;
  /** Lower-case substring of the payee. */
  match_counterparty: string;
  match_payment_method: string | null;
  action: TransactionRuleAction;
  category_id: string | null;
  transfer_kind: TransferKind | null;
  account_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Statement attachments.
// ---------------------------------------------------------------------------

/** A PDF sent with a statement email by the Gmail Apps Script. Processed in memory, never stored. */
export interface InboxIngestAttachment {
  name: string;
  contentType: string;
  base64: string;
}

export type StatementSampleStatus = 'captured' | 'locked' | 'failed';

/** Masked statement text captured (opt-in, INBOX_CAPTURE_STATEMENT_TEXT=1) to write parsers against. */
export interface StatementSample {
  id: string;
  owner: InboxOwner;
  source: string;
  inbox_item_id: string | null;
  attachment_name: string;
  status: StatementSampleStatus;
  detail: string | null;
  page_count: number | null;
  password_hint: string | null;
  text: string | null;
  created_at: string;
}
