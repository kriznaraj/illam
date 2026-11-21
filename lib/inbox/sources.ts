/**
 * The senders the inbox listens to. This list is the single source of truth:
 * the Gmail Apps Script fetches its search query from GET /api/inbox/ingest,
 * so adding a sender here needs a deploy but no change in either Gmail account.
 */

export type InboxSourceId =
  | 'hdfc_alerts'
  | 'axis_alerts'
  | 'hdfc_card_statement'
  | 'axis_card_statement'
  | 'icici_cards'
  | 'icici_card_statement'
  | 'kotak_alerts'
  | 'kotak_account_statement'
  | 'groww'
  | 'hdfc_account_statement'
  | 'cdsl_cas'
  | 'nsdl_cas'
  | 'nps_protean'
  | 'indmoney'
  | 'sbi_account_statement'
  | 'zerodha'
  | 'bob_card_statement';

export type InboxExtractorId =
  | 'bank_alert'
  | 'card_statement'
  | 'card_mixed'
  | 'account_statement'
  | 'investment_statement'
  | 'indmoney'
  | 'groww';

export interface InboxSource {
  id: InboxSourceId;
  institution: string;
  /**
   * Lower-case sender addresses. Older domains are kept so a backfill still matches.
   * An entry starting with "@" is a whole domain — for a bank whose exact addresses are
   * not known yet; tighten it once real mail shows its from_address.
   */
  senders: readonly string[];
  extractor: InboxExtractorId;
  provider?: 'cdsl' | 'nsdl' | 'nps' | 'indmoney' | 'groww' | 'zerodha';
  /** The script sends this sender's PDF attachments too (statements); everyone else sends names only. */
  attachments?: boolean;
}

export const INBOX_SOURCES: readonly InboxSource[] = [
  {
    id: 'hdfc_alerts',
    institution: 'HDFC Bank',
    senders: ['alerts@hdfcbank.bank.in', 'alerts@hdfcbank.net'],
    extractor: 'bank_alert',
  },
  {
    id: 'axis_alerts',
    institution: 'Axis Bank',
    senders: ['alerts@axis.bank.in', 'alerts@axisbank.com'],
    extractor: 'bank_alert',
  },
  {
    id: 'hdfc_card_statement',
    institution: 'HDFC Bank',
    senders: ['emailstatements.cards@hdfcbank.bank.in', 'emailstatements.cards@hdfcbank.net'],
    extractor: 'card_statement',
    attachments: true,
  },
  {
    id: 'axis_card_statement',
    institution: 'Axis Bank',
    senders: ['cc.statements@axis.bank.in', 'cc.statements@axisbank.com'],
    extractor: 'card_statement',
    attachments: true,
  },
  {
    // Savings/current account statements, PDF attached. HDFC has moved the combined
    // statement to the smartstatement address before, and listening on only the old one
    // silently drops that month's snapshots; keep both.
    id: 'hdfc_account_statement',
    institution: 'HDFC Bank',
    senders: ['corporatenetbanking.automailer@hdfcbank.bank.in', 'hdfcbanksmartstatement@hdfcbank.bank.in'],
    extractor: 'account_statement',
    attachments: true,
  },
  {
    // One ICICI address sends both card transaction alerts and statements (with PDFs),
    // so the extractor routes each email by its subject.
    id: 'icici_cards',
    institution: 'ICICI Bank',
    senders: ['cards@icici.bank.in'],
    extractor: 'card_mixed',
    attachments: true,
  },
  {
    // ICICI card statements also arrive from a second address. Only a minority of its
    // mails carry a statement; the rest are routed like cards@icici.
    id: 'icici_card_statement',
    institution: 'ICICI Bank',
    senders: ['credit_cards@icici.bank.in'],
    extractor: 'card_mixed',
    attachments: true,
  },
  {
    // BOBCARD Uni — may be rarely used, tracked so its bill is never missed.
    // No statement reader yet: the bill email is read, the PDF sampled.
    id: 'bob_card_statement',
    institution: 'BOBCARD',
    senders: ['donotreply@bobcard.in'],
    extractor: 'card_statement',
    attachments: true,
  },
  {
    // Kotak account alerts.
    id: 'kotak_alerts',
    institution: 'Kotak Bank',
    senders: ['bankalerts@kotak.bank.in', 'mobilebanking.alerts@kotak.bank.in'],
    extractor: 'bank_alert',
  },
  {
    id: 'kotak_account_statement',
    institution: 'Kotak Bank',
    senders: ['bankstatements@kotak.bank.in'],
    extractor: 'account_statement',
    attachments: true,
  },
  {
    // SBI e-account statements (found by findStatements). Sampled until a reader
    // exists — SBI accounts have no other source.
    id: 'sbi_account_statement',
    institution: 'SBI',
    senders: ['cbssbi.cas@alerts.sbi.bank.in'],
    extractor: 'account_statement',
    attachments: true,
  },
  {
    // Groww mutual funds. One address sends statements (PAN-protected PDFs),
    // order confirmations and marketing; the extractor keeps only statements as such.
    id: 'groww',
    institution: 'Groww',
    senders: ['noreply@groww.in'],
    extractor: 'groww',
    provider: 'groww',
    attachments: true,
  },
  {
    id: 'cdsl_cas',
    institution: 'CDSL',
    senders: ['ecas@cdslstatement.com'],
    extractor: 'investment_statement',
    provider: 'cdsl',
    attachments: true,
  },
  {
    // Whichever depository holds the newer demat account sends the consolidated
    // statement, so a CAS may come from NSDL instead of CDSL.
    id: 'nsdl_cas',
    institution: 'NSDL',
    senders: ['nsdl-cas@nsdl.co.in'],
    extractor: 'investment_statement',
    provider: 'nsdl',
    attachments: true,
  },
  {
    id: 'nps_protean',
    institution: 'NPS',
    senders: ['nps-statements@mailer.proteantech.in'],
    extractor: 'investment_statement',
    provider: 'nps',
    attachments: true,
  },
  {
    // Trades, dividends and deposits, plus a weekly statement PDF (Sundays) — captured so
    // a US-stocks reader can be written against its real layout; until one exists it is
    // only sampled.
    id: 'indmoney',
    institution: 'INDmoney',
    senders: ['transactions@transactions.indmoney.com'],
    extractor: 'indmoney',
    provider: 'indmoney',
    attachments: true,
  },
  {
    // Weekly funds statements and the monthly demat holding statement (found by
    // findStatements) — the Kite wallets' balance. Sampled until a reader exists.
    id: 'zerodha',
    institution: 'Zerodha',
    senders: ['no-reply-account-statement@reportsmailer.zerodha.net'],
    extractor: 'investment_statement',
    provider: 'zerodha',
    attachments: true,
  },
];

/** `"HDFC Bank InstaAlerts <alerts@hdfcbank.bank.in>"` → `alerts@hdfcbank.bank.in`. */
export function senderAddress(from: string): string {
  const bracketed = from.match(/<([^>]+)>/);
  return (bracketed ? bracketed[1] : from).trim().toLowerCase();
}

export function matchSource(from: string, sources: readonly InboxSource[] = INBOX_SOURCES): InboxSource | null {
  const address = senderAddress(from);
  const exact = sources.find((source) => source.senders.includes(address));
  if (exact) return exact;
  // A domain entry ("@kotak.com") matches any address at exactly that domain, never a look-alike.
  return sources.find((source) => source.senders.some((sender) => sender.startsWith('@') && address.endsWith(sender))) ?? null;
}

/**
 * Gmail search query for the Apps Script. OTP mail is excluded here as a first
 * line of defence; `isSensitiveMessage` drops anything that slips through.
 */
export function buildGmailQuery(sources: readonly InboxSource[] = INBOX_SOURCES): string {
  const senders = sources.flatMap((source) => source.senders);
  const addresses = senders.filter((sender) => !sender.startsWith('@'));
  const domains = senders.filter((sender) => sender.startsWith('@')).map((sender) => sender.slice(1));
  const exact = `from:(${addresses.join(' OR ')})`;
  // A whole domain also sends marketing, which Gmail files under Promotions.
  const from = domains.length > 0 ? `(${exact} OR (from:(${domains.join(' OR ')}) -category:promotions))` : exact;
  return `${from} -subject:(OTP OR "one time password")`;
}

/** Senders whose PDFs the script should send along (statements). */
export function attachmentSenders(sources: readonly InboxSource[] = INBOX_SOURCES): string[] {
  // The script compares exact addresses, so a domain entry can never carry attachments.
  return sources
    .filter((source) => source.attachments)
    .flatMap((source) => source.senders)
    .filter((sender) => !sender.startsWith('@'));
}
