import { describe, it, expect } from 'vitest';
import { buildGmailQuery, INBOX_SOURCES, matchSource, senderAddress } from '../sources';

describe('senderAddress', () => {
  it('extracts and lower-cases the address from a display name', () => {
    expect(senderAddress('HDFC Bank InstaAlerts <Alerts@HDFCBank.bank.in>')).toBe('alerts@hdfcbank.bank.in');
    expect(senderAddress(' eCAS@cdslstatement.com ')).toBe('ecas@cdslstatement.com');
  });
});

describe('matchSource', () => {
  // The senders the household actually receives, as given by the user.
  it.each([
    ['eCAS@cdslstatement.com', 'cdsl_cas'],
    ['transactions@transactions.indmoney.com', 'indmoney'],
    ['alerts@hdfcbank.bank.in', 'hdfc_alerts'],
    ['Emailstatements.cards@hdfcbank.bank.in', 'hdfc_card_statement'],
    ['alerts@axis.bank.in', 'axis_alerts'],
    ['cc.statements@axis.bank.in', 'axis_card_statement'],
    ['nps-statements@mailer.proteantech.in', 'nps_protean'],
    ['cards@icici.bank.in', 'icici_cards'],
    ['credit_cards@icici.bank.in', 'icici_card_statement'],
    // HDFC's combined statement moved here with September 2026's; missing it emptied October.
    ['hdfcbanksmartstatement@hdfcbank.bank.in', 'hdfc_account_statement'],
    ['cbssbi.cas@alerts.sbi.bank.in', 'sbi_account_statement'],
    ['no-reply-account-statement@reportsmailer.zerodha.net', 'zerodha'],
    ['donotreply@bobcard.in', 'bob_card_statement'],
    ['bankalerts@kotak.bank.in', 'kotak_alerts'],
    ['MobileBanking.Alerts@kotak.bank.in', 'kotak_alerts'],
    ['BankStatements@kotak.bank.in', 'kotak_account_statement'],
    ['noreply@groww.in', 'groww'],
    ['corporatenetbanking.automailer@hdfcbank.bank.in', 'hdfc_account_statement'],
  ])('maps %s to %s', (from, id) => {
    expect(matchSource(`Sender <${from}>`)?.id).toBe(id);
  });

  it('matches whole addresses only, not look-alikes', () => {
    expect(matchSource('alerts@hdfcbank.bank.in.example.com')).toBeNull();
    expect(matchSource('notalerts@hdfcbank.bank.in')).toBeNull();
    expect(matchSource('someone@gmail.com')).toBeNull();
    expect(matchSource('offers@kotak.bank.in')).toBeNull();
    expect(matchSource('bankalerts@kotak.bank.in.example.com')).toBeNull();
  });
});

describe('buildGmailQuery with domain senders', () => {
  it('asks for whole domains outside Promotions, alongside the exact addresses', () => {
    const query = buildGmailQuery([
      { id: 'hdfc_alerts', institution: 'HDFC Bank', senders: ['alerts@hdfcbank.bank.in'], extractor: 'bank_alert' },
      { id: 'kotak_alerts', institution: 'Kotak Bank', senders: ['@kotak.com'], extractor: 'bank_alert' },
    ]);
    expect(query).toBe('(from:(alerts@hdfcbank.bank.in) OR (from:(kotak.com) -category:promotions)) -subject:(OTP OR "one time password")');
  });
});

describe('INBOX_SOURCES', () => {
  it('stores senders lower-case and never lists one under two sources', () => {
    const all = INBOX_SOURCES.flatMap((s) => s.senders);
    expect(all.every((s) => s === s.toLowerCase())).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('buildGmailQuery', () => {
  it('covers every sender and excludes OTP subjects', () => {
    const query = buildGmailQuery();
    // A domain entry ("@kotak.com") is asked for as the bare domain.
    for (const sender of INBOX_SOURCES.flatMap((s) => s.senders)) {
      expect(query).toContain(sender.replace(/^@/, ''));
    }
    expect(query).toContain('-subject:(OTP');
  });
});
