-- migrate:up
-- Illam schema: every table, function and trigger the app uses.
-- One deployment serves one household (see lib/household.ts); RLS is enabled in
-- 0003_security.sql. Add later changes as new numbered files in db/migrations/.


-- ============================================
-- EXPENSE TRACKING (SELAVU) - 7 tables (income is under MADAL)
-- ============================================

-- Users. Rows are expected to share ids with Supabase Auth users
-- (lib/AuthContext.tsx looks the profile up by the auth uid).
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  icon TEXT,
  email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expense categories. group_name is the planning dimension used by the
-- actionable summary in app/api/expenses/route.ts and is one of:
-- 'Need' | 'Want' | 'One-time' | 'Unplanned'. Canonical seed list lives in
-- supabase/migrations/022_normalize_expense_categories.sql.
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL,
  icon TEXT,
  budget DECIMAL(15, 2),
  color TEXT NOT NULL DEFAULT '#3B82F6',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expense events: a *spending bucket* (a trip, a renovation, a celebration).
-- Distinct from family_tracker_events, which is a life event / habit.
-- Renamed from `events` in migration 015.
CREATE TABLE IF NOT EXISTS expense_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  budget DECIMAL(15, 2),
  color TEXT NOT NULL DEFAULT '#3B82F6',
  is_active BOOLEAN NOT NULL DEFAULT true,
  family_tracker_event_id UUID, -- FK added after family_tracker_events below
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tags (labels). Names are lowercase with underscores, auto-created on use.
-- The shared `unplanned` tag is seeded by migration 023, and `auto` by migration 036.
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expenses. `entered_by` is a deprecated leftover; `user_id` is the attribution.
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id),
  description TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  event_id UUID REFERENCES expense_events(id) ON DELETE SET NULL,
  entered_by UUID, -- deprecated; no FK, so PostgREST embeds users via user_id unambiguously
  receipt_url TEXT,
  -- Migration 030 (Madal automation). needs_review means auto-added from a bank alert or
  -- statement and not yet looked at. Since migration 036 such a row counts everywhere from
  -- the moment it is created; the flag only drives the review queue. The one place it is
  -- still honoured is category evidence (lib/expenses/merchantHistory.ts).
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'inbox', 'statement')),
  inbox_item_id UUID, -- FK added after inbox_items below
  payment_method TEXT,
  merchant TEXT,
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  -- Migration 038. Time of the spend (Asia/Kolkata); approx = the alert's arrival time.
  spent_time TIME,
  spent_time_approx BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Denormalized monthly rollup, maintained by trigger (see TRIGGERS below).
-- Powers the 12-month baseline in GET /api/expenses?summary=baseline.
CREATE TABLE IF NOT EXISTS expense_monthly_totals (
  month DATE PRIMARY KEY,
  total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  expense_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expense <-> tag junction
CREATE TABLE IF NOT EXISTS expense_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(expense_id, tag_id)
);

-- ============================================
-- PORTFOLIO (SELVAM) - 7 tables
-- ============================================

-- Account types. `is_equity` (migration 017) drives the all-vs-equity scope
-- toggle on /portfolio; `show_in_growth` excludes a type from growth maths.
-- `is_liability` (migration 028) marks money owed — snapshots for accounts of such
-- a type are stored NEGATIVE, because every net-worth figure is a plain sum(amount).
-- True for 'Credit Card' and 'Loan'.
CREATE TABLE IF NOT EXISTS portfolio_account_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  show_in_growth BOOLEAN NOT NULL DEFAULT false,
  is_equity BOOLEAN NOT NULL DEFAULT false,
  is_liability BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Accounts. `type` is a soft foreign key onto portfolio_account_types.name.
-- `details` is a free-form bag; for credit cards it carries
-- { is_credit_card, bank, last4, billing_date, due_date, ... }
-- and for SIP-bearing accounts it carries a `funds` array.
CREATE TABLE IF NOT EXISTS portfolio_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  notes TEXT,
  details JSONB,
  multiplier DECIMAL(15, 6),
  unit TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Cash, outside the investment boundary (migration 033). NULL = decided by type:
  -- Saving Account and Salary Account are cash. Contributions are money crossing into
  -- accounts that are neither cash nor liabilities.
  is_cash BOOLEAN
);

-- Month-end balance series. snapshot_date is always the 1st of the month.
-- `amount` is signed: liability accounts (portfolio_account_types.is_liability)
-- are stored NEGATIVE, since every net-worth figure is a plain sum(amount).
-- PortfolioSnapshotService normalises this on write; see migration 028.
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES portfolio_accounts(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  units DECIMAL(20, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, snapshot_date)
);

-- Individual instruments held inside an account
CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES portfolio_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  symbol TEXT,
  identifier TEXT NOT NULL,
  instrument_type TEXT NOT NULL CHECK (instrument_type IN (
    'nse_stock', 'bse_stock', 'mf_nav', 'us_stock',
    'gold_etf', 'gold_physical', 'gold_rate', 'sgb', 'bond', 'nps', 'manual'
  )),
  quantity_unit TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  details JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Holding-level balance series
CREATE TABLE IF NOT EXISTS portfolio_holding_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id UUID NOT NULL REFERENCES portfolio_holdings(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  quantity NUMERIC(20, 6) NOT NULL DEFAULT 0,
  unit_amount DECIMAL(15, 6),
  amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(holding_id, snapshot_date)
);

-- Contribution ledger (migrations 018, 019). Negative amounts represent
-- withdrawals. Auto-SIP rows are derived from portfolio_accounts.details.funds
-- and are written here with note = '__AUTO_MONTHLY__'.
CREATE TABLE IF NOT EXISTS portfolio_investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES portfolio_accounts(id) ON DELETE CASCADE,
  investment_date DATE NOT NULL,
  amount DECIMAL(15, 2) NOT NULL CONSTRAINT portfolio_investments_amount_check CHECK (amount <> 0),
  kind TEXT NOT NULL DEFAULT 'adhoc' CHECK (kind IN ('adhoc', 'recurring')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The bank transfer that created or claimed this contribution (migration 034): one money record
  -- per movement. Unique where set; FK added after `transfers` below.
  transfer_id UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_investments_transfer_id_key
  ON portfolio_investments(transfer_id) WHERE transfer_id IS NOT NULL;

-- Gold register: physical jewellery/coins/bars and Sovereign Gold Bonds.
-- gross_weight is the item weight, gold_weight the pure-gold content.
-- item_type is 'physical' | 'sgb'; maturity_date applies to SGBs only.
CREATE TABLE IF NOT EXISTS gold_register (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'physical',
  purchased_from TEXT,
  purchased_at DATE,
  maturity_date DATE,
  buy_price DECIMAL(15, 2),
  gross_weight DECIMAL(10, 3),
  gold_weight DECIMAL(10, 3) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- CREDIT CARDS - 1 table
-- ============================================

-- One payment per statement, tracked inline (no separate payments table --
-- see SCHEMA_CLEANUP_SUMMARY.md). Billing and due *days* live on
-- portfolio_accounts.details, not here.
CREATE TABLE IF NOT EXISTS credit_card_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES portfolio_accounts(id) ON DELETE SET NULL,
  period_start DATE,
  period_end DATE,
  statement_date DATE NOT NULL,
  due_date DATE NOT NULL,
  statement_amount DECIMAL(15, 2) NOT NULL,
  amount_paid DECIMAL(15, 2) DEFAULT 0,
  payment_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- ACTIVITY TRACKER - 2 tables
-- ============================================

-- Three event types (migration 025 collapsed the earlier four):
--   one_time  - a milestone; open until closed by hand. No occurrences.
--   activity  - an ongoing habit/service. This row is the series parent;
--               each log inserts a family_tracker_occurrences row.
--   annual    - birthdays/anniversaries. Cannot be closed by hand;
--               advanceAnnualEvents() closes the past row and inserts next
--               year's row carrying the same series_id.
-- series_id is populated for annual events only (trigger below).
CREATE TABLE IF NOT EXISTS family_tracker_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL CONSTRAINT family_tracker_events_event_type_check
    CHECK (event_type IN ('one_time', 'activity', 'annual')),
  event_date DATE NOT NULL,
  status TEXT NOT NULL CONSTRAINT family_tracker_events_status_check
    CHECK (status IN ('open', 'closed')),
  reminder_days_before INTEGER DEFAULT 7,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One log per activity per day. The unique constraint surfaces as HTTP 409
-- through lib/activity-tracker/apiErrors.ts.
CREATE TABLE IF NOT EXISTS family_tracker_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES family_tracker_events(id) ON DELETE CASCADE,
  occurred_at DATE NOT NULL DEFAULT CURRENT_DATE,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, occurred_at)
);

ALTER TABLE expense_events
  ADD CONSTRAINT expense_events_family_tracker_event_id_fkey
  FOREIGN KEY (family_tracker_event_id) REFERENCES family_tracker_events(id) ON DELETE SET NULL;

COMMENT ON TABLE family_tracker_events IS 'Activity Tracker events: one_time (milestones), activity (ongoing tracking), annual (birthdays/anniversaries)';
COMMENT ON TABLE family_tracker_occurrences IS 'Activity occurrence logs (one-click tracking)';

-- ============================================
-- PRODUCTIVITY & CONFIG - 4 tables
-- ============================================

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_pinned BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- user_id is an optional *assignee*, not an owner (migration 020).
CREATE TABLE IF NOT EXISTS todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insight cache, one row per analysed month. Keyed by analysis_month
-- ('YYYY-MM'); upserted on that column by lib/repositories/InsightsRepository.ts.
--
-- generated_by is a UUID holding *user* ids on historical rows — verified against the
-- live database, which rejects a non-UUID with `invalid input syntax for type uuid`.
-- This file previously declared it TEXT, which is what made writing 'rules' into it look
-- safe. It is not: the upsert's error is non-fatal, so the failure silently disables
-- insight caching for every month. The engine ('ai' | 'rules') lives in summary.generatedBy.
CREATE TABLE IF NOT EXISTS insights_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_month TEXT NOT NULL UNIQUE,
  insights JSONB NOT NULL,
  summary JSONB,
  generated_at TIMESTAMPTZ,
  generated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Key/value app config (migration 016). Currently holds gold_rate_22k and
-- gold_rate_24k, editable from the Gold Register page.
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================
-- MADAL (INBOX) - 6 tables
-- ============================================

-- Extracted details of important mail from both Gmail accounts (migration 029).
-- Pushed by scripts/gmail-apps-script via POST /api/inbox/ingest. Never holds the
-- email body, OTP mail, or full card/account numbers. `status` is the user's and
-- is omitted from the ingest upsert, so re-delivery never resets it.
CREATE TABLE IF NOT EXISTS inbox_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner             TEXT NOT NULL,
  mailbox           TEXT NOT NULL,
  gmail_message_id  TEXT NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL,
  from_address      TEXT NOT NULL,
  source            TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('transaction', 'card_statement', 'investment_statement', 'trade', 'notice')),
  title             TEXT NOT NULL,
  summary           TEXT,
  data              JSONB NOT NULL DEFAULT '{}'::jsonb,
  attachment_names  TEXT[] NOT NULL DEFAULT '{}',
  needs_attention   BOOLEAN NOT NULL DEFAULT FALSE,
  attention_reason  TEXT,
  action_by         DATE,
  status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done', 'dismissed')),
  extractor         TEXT NOT NULL,
  extractor_version INTEGER NOT NULL DEFAULT 1,
  consumed          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner, gmail_message_id)
);

ALTER TABLE expenses
  ADD CONSTRAINT expenses_inbox_item_id_fkey
  FOREIGN KEY (inbox_item_id) REFERENCES inbox_items(id) ON DELETE SET NULL;

-- Money received (migration 035). Its own table, not a negative expense: `expenses` is read
-- by ~30 sites (the monthly-total SQL function, insights, stats, three report repositories,
-- the actionable summary) and each would have to filter the sign, where one miss silently
-- understates spending. A credit that is NOT earnings — a card refund, a bill payment landing
-- back on the card, money moved between the household's own accounts — never reaches here; it
-- becomes a `transfers` row and is classified in Madal.
CREATE TABLE IF NOT EXISTS income (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date          DATE NOT NULL,
  amount        DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  -- Dividends arrive in USD inside the INDmoney wallet and are stored as paid; this app holds
  -- no exchange rate, so a converted rupee figure here would be invented.
  currency      TEXT NOT NULL DEFAULT 'INR',
  kind          TEXT NOT NULL CHECK (kind IN ('salary', 'dividend', 'interest', 'refund', 'reimbursement', 'rent', 'gift', 'other')),
  source_name   TEXT,
  description   TEXT,
  user_id       UUID NOT NULL REFERENCES users(id),
  -- Set when the money landed inside a Selvam account rather than a bank account.
  account_id    UUID REFERENCES portfolio_accounts(id) ON DELETE SET NULL,
  inbox_item_id UUID REFERENCES inbox_items(id) ON DELETE SET NULL,
  -- 'statement': read off a bank statement line (037), keyed by statement_ref.
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'inbox', 'statement')),
  statement_ref TEXT,
  needs_review  BOOLEAN NOT NULL DEFAULT FALSE,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One credit alert can only ever produce one income row — the same guard `expenses` and
-- `transfers` carry, because the two Gmail accounts sync independently.
CREATE UNIQUE INDEX IF NOT EXISTS income_inbox_item_id_key
  ON income(inbox_item_id) WHERE inbox_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS income_date_idx ON income(date DESC);
CREATE INDEX IF NOT EXISTS income_user_date_idx ON income(user_id, date DESC);
CREATE INDEX IF NOT EXISTS income_kind_idx ON income(kind);
CREATE UNIQUE INDEX IF NOT EXISTS income_statement_ref_key
  ON income(statement_ref) WHERE statement_ref IS NOT NULL;

-- Money that moved but was not spent, logged from alerts (migration 030). Ad-hoc
-- transfers stay needs_review until the user classifies them in Madal.
CREATE TABLE IF NOT EXISTS transfers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_item_id            UUID UNIQUE REFERENCES inbox_items(id) ON DELETE SET NULL,
  owner                    TEXT NOT NULL,
  date                     DATE NOT NULL,
  amount                   DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  direction                TEXT NOT NULL DEFAULT 'debit' CHECK (direction IN ('debit', 'credit')),
  counterparty             TEXT,
  payment_method           TEXT,
  kind                     TEXT NOT NULL CHECK (kind IN ('own_account', 'investment', 'loan', 'card_bill', 'cash', 'tax', 'family', 'other')),
  account_id               UUID REFERENCES portfolio_accounts(id) ON DELETE SET NULL,
  portfolio_investment_id  UUID REFERENCES portfolio_investments(id) ON DELETE SET NULL,
  credit_card_statement_id UUID REFERENCES credit_card_statements(id) ON DELETE SET NULL,
  expense_id               UUID REFERENCES expenses(id) ON DELETE SET NULL,
  note                     TEXT,
  status                   TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review', 'confirmed')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A debit that is a virtual SIP instalment claims it here instead of adding a row (migration 034).
  sip_fund                 TEXT,
  sip_month                TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS transfers_sip_claim_key
  ON transfers(account_id, sip_fund, sip_month) WHERE sip_fund IS NOT NULL;
ALTER TABLE portfolio_investments
  ADD CONSTRAINT portfolio_investments_transfer_id_fkey
  FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE SET NULL;

-- Lines of recorded card statements and how each reconciled with expenses (migration 032).
-- A matched/added/ignored line is final: deleting its expense never brings it back.
CREATE TABLE IF NOT EXISTS statement_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id  UUID NOT NULL REFERENCES credit_card_statements(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES portfolio_accounts(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL,
  txn_date      DATE NOT NULL,
  description   TEXT NOT NULL,
  merchant      TEXT,
  amount        DECIMAL(15, 2) NOT NULL CHECK (amount >= 0),
  direction     TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  status        TEXT NOT NULL CHECK (status IN ('matched', 'added', 'unmatched', 'ignored')),
  expense_id    UUID REFERENCES expenses(id) ON DELETE SET NULL,
  inbox_item_id UUID REFERENCES inbox_items(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (statement_id, line_no)
);

-- "Remember for <payee>" decisions; later runs apply them without asking (migration 030).
CREATE TABLE IF NOT EXISTS transaction_rules (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner                TEXT,
  match_counterparty   TEXT NOT NULL,
  match_payment_method TEXT,
  action               TEXT NOT NULL CHECK (action IN ('expense', 'transfer', 'ignore')),
  category_id          UUID REFERENCES categories(id) ON DELETE SET NULL,
  transfer_kind        TEXT CHECK (transfer_kind IN ('own_account', 'investment', 'loan', 'card_bill', 'cash', 'tax', 'family', 'other')),
  account_id           UUID REFERENCES portfolio_accounts(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- app_config key inbox_auto_add_from (migration 030): alerts dated before it only
-- enrich existing expenses and never create new ones.

-- TEMPORARY (migration 031): masked statement text captured while
-- INBOX_CAPTURE_STATEMENT_TEXT=1, to write lib/statements parsers against real
-- layouts. Drop once the parsers exist.
CREATE TABLE IF NOT EXISTS statement_samples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner           TEXT NOT NULL,
  source          TEXT NOT NULL,
  inbox_item_id   UUID REFERENCES inbox_items(id) ON DELETE CASCADE,
  attachment_name TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('captured', 'locked', 'failed')),
  detail          TEXT,
  page_count      INTEGER,
  password_hint   TEXT,
  text            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inbox_item_id, attachment_name)
);

-- Insurance premiums, loan EMIs (migration 037): declared once, never expenses; shown on
-- /cash-flow in the months they fall due. A debit containing match_text is the payment.
CREATE TABLE IF NOT EXISTS commitments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('insurance', 'loan', 'other')),
  amount       DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  frequency    TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'half_yearly', 'annual')),
  start_month  TEXT NOT NULL CHECK (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  due_day      SMALLINT NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 31),
  end_month    TEXT CHECK (end_month IS NULL OR end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  match_text   TEXT,
  account_id   UUID REFERENCES portfolio_accounts(id) ON DELETE SET NULL,
  note         TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Evidence a commitment was paid for a due month; transfer_id keeps the report from counting
-- the same debit again as an "other" transfer.
CREATE TABLE IF NOT EXISTS commitment_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id  UUID NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  due_month      TEXT NOT NULL CHECK (due_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  paid_date      DATE NOT NULL,
  amount         DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  source         TEXT NOT NULL CHECK (source IN ('statement', 'alert', 'manual')),
  inbox_item_id  UUID REFERENCES inbox_items(id) ON DELETE SET NULL,
  transfer_id    UUID REFERENCES transfers(id) ON DELETE SET NULL,
  -- Paid ahead: also settles later due months up to this one (they count ₹0).
  covers_through TEXT CHECK (covers_through IS NULL OR covers_through ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commitment_id, due_month)
);
CREATE INDEX IF NOT EXISTS commitment_payments_due_month_idx ON commitment_payments(due_month);

-- Migration 039. What Madal decided on its own (Claude, or a bank statement's proof), with
-- everything needed to undo it in `before`. No FKs on transfer_id / expense_id: undo must work
-- after a decision deleted or recreated those rows.
CREATE TABLE IF NOT EXISTS madal_decisions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_item_id  UUID REFERENCES inbox_items(id) ON DELETE SET NULL,
  transfer_id    UUID,
  expense_id     UUID,
  decided_by     TEXT NOT NULL CHECK (decided_by IN ('claude', 'statement')),
  action         TEXT NOT NULL CHECK (action IN ('classified', 'refiled', 'suggested', 'categorised', 'committed')),  -- 'committed': 040
  kind           TEXT,
  reason         TEXT NOT NULL,
  evidence       TEXT,
  evidence_key   TEXT,
  before         JSONB NOT NULL DEFAULT '{}'::jsonb,
  model          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  undone_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS madal_decisions_item_idx ON madal_decisions(inbox_item_id);
CREATE INDEX IF NOT EXISTS madal_decisions_transfer_idx ON madal_decisions(transfer_id);
CREATE INDEX IF NOT EXISTS madal_decisions_expense_idx ON madal_decisions(expense_id);

-- ============================================
-- INDEXES
-- ============================================

-- Madal (inbox)
CREATE INDEX IF NOT EXISTS idx_inbox_items_received_at ON inbox_items(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_items_attention ON inbox_items(received_at DESC)
  WHERE status = 'new' AND needs_attention;

-- Expenses
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_event ON expenses(event_id);
CREATE INDEX IF NOT EXISTS idx_expense_tags_expense ON expense_tags(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_tags_tag ON expense_tags(tag_id);

-- Portfolio
CREATE INDEX IF NOT EXISTS idx_portfolio_accounts_type ON portfolio_accounts(type);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_account ON portfolio_snapshots(account_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_date ON portfolio_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_holdings_account ON portfolio_holdings(account_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_holding_snapshots_holding ON portfolio_holding_snapshots(holding_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_holding_snapshots_date ON portfolio_holding_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_investments_account_id ON portfolio_investments(account_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_investments_date ON portfolio_investments(investment_date DESC);

-- Credit cards
CREATE INDEX IF NOT EXISTS idx_cc_statements_account ON credit_card_statements(account_id);
CREATE INDEX IF NOT EXISTS idx_cc_statements_date ON credit_card_statements(statement_date DESC);

-- Activity Tracker
CREATE INDEX IF NOT EXISTS idx_family_tracker_events_date ON family_tracker_events(event_date);
CREATE INDEX IF NOT EXISTS idx_family_tracker_events_status ON family_tracker_events(status);
CREATE INDEX IF NOT EXISTS idx_family_tracker_events_type_status ON family_tracker_events(event_type, status);
CREATE INDEX IF NOT EXISTS idx_family_tracker_series ON family_tracker_events(series_id);
CREATE INDEX IF NOT EXISTS idx_family_tracker_occurrences_event ON family_tracker_occurrences(event_id);
CREATE INDEX IF NOT EXISTS idx_family_tracker_occurrences_date ON family_tracker_occurrences(occurred_at DESC);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recompute one month's row in expense_monthly_totals, deleting it when the
-- month has no expenses left. Every expense counts, auto-added ones included
-- (migration 036) — an alert that reached Madal is money that left the account.
CREATE OR REPLACE FUNCTION refresh_expense_monthly_total(p_month DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  month_start DATE;
  month_end DATE;
BEGIN
  month_start := date_trunc('month', p_month)::date;
  month_end := (month_start + INTERVAL '1 month')::date;

  INSERT INTO expense_monthly_totals (month, total_amount, expense_count, updated_at)
  SELECT
    month_start,
    COALESCE(SUM(amount), 0)::DECIMAL(15, 2),
    COUNT(*)::INTEGER,
    NOW()
  FROM expenses
  WHERE date >= month_start
    AND date < month_end
  ON CONFLICT (month) DO UPDATE
  SET
    total_amount = EXCLUDED.total_amount,
    expense_count = EXCLUDED.expense_count,
    updated_at = NOW();

  IF NOT EXISTS (
    SELECT 1
    FROM expenses
    WHERE date >= month_start
      AND date < month_end
  ) THEN
    DELETE FROM expense_monthly_totals WHERE month = month_start;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sync_expense_monthly_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_expense_monthly_total(NEW.date);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM refresh_expense_monthly_total(OLD.date);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM refresh_expense_monthly_total(OLD.date);
    IF NEW.date <> OLD.date THEN
      PERFORM refresh_expense_monthly_total(NEW.date);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION set_portfolio_investments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Annual events only: chain each year's row to the first one (migration 025).
CREATE OR REPLACE FUNCTION set_series_id_default()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'annual' AND NEW.series_id IS NULL THEN
    NEW.series_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER expenses_monthly_totals_sync
  AFTER INSERT OR UPDATE OF date, amount, needs_review OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION sync_expense_monthly_totals();

CREATE TRIGGER expense_events_updated_at BEFORE UPDATE ON expense_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tags_updated_at BEFORE UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER portfolio_holdings_updated_at BEFORE UPDATE ON portfolio_holdings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_portfolio_investments_updated_at BEFORE UPDATE ON portfolio_investments
  FOR EACH ROW EXECUTE FUNCTION set_portfolio_investments_updated_at();

CREATE TRIGGER trigger_set_series_id BEFORE INSERT ON family_tracker_events
  FOR EACH ROW EXECUTE FUNCTION set_series_id_default();

CREATE TRIGGER inbox_items_updated_at BEFORE UPDATE ON inbox_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER transfers_updated_at BEFORE UPDATE ON transfers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- RPCs used by /home (lib/repositories/HomeStatsRepository.ts)
-- ============================================

-- The newest snapshot of every account.
CREATE OR REPLACE FUNCTION get_latest_snapshots_per_account()
RETURNS TABLE (account_id UUID, snapshot_date DATE, amount DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (s.account_id) s.account_id, s.snapshot_date, s.amount::double precision
  FROM portfolio_snapshots s
  ORDER BY s.account_id, s.snapshot_date DESC;
$$;

-- For every account, the newest snapshot before its newest one: what net worth was last time.
CREATE OR REPLACE FUNCTION get_prev_snapshots_per_account()
RETURNS TABLE (account_id UUID, snapshot_date DATE, amount DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (s.account_id) s.account_id, s.snapshot_date, s.amount::double precision
  FROM portfolio_snapshots s
  JOIN (
    SELECT account_id, MAX(snapshot_date) AS latest FROM portfolio_snapshots GROUP BY account_id
  ) l ON l.account_id = s.account_id AND s.snapshot_date < l.latest
  ORDER BY s.account_id, s.snapshot_date DESC;
$$;

-- migrate:down
-- Not reversible: drop the database to start over.
