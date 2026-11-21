import { describe, it, expect } from 'vitest';
import { configuredPasswordSources, statementPasswords } from '../passwords';

describe('configuredPasswordSources', () => {
  it('lists source names with at least one password, never the values', () => {
    const env = { STATEMENT_PASSWORDS_ALICE: JSON.stringify({ cdsl_cas: ['ABCDE1234F'], axis_card_statement: [], '*': 'X' }) };
    const result = configuredPasswordSources('alice', env);
    expect(result).toEqual({
      configured: true,
      valid: true,
      sources: ['cdsl_cas', '*'],
      shapes: { cdsl_cas: ['10ch A9'], '*': ['1ch A'] },
    });
    expect(JSON.stringify(result)).not.toContain('ABCDE1234F');
  });

  it('distinguishes missing from malformed', () => {
    expect(configuredPasswordSources('bob', {})).toEqual({ configured: false, valid: false, sources: [], shapes: {} });
    expect(configuredPasswordSources('alice', { STATEMENT_PASSWORDS_ALICE: '{oops' })).toEqual({
      configured: true,
      valid: false,
      sources: [],
      shapes: {},
    });
  });
});
import { passwordHint, redactStatementText, MAX_SAMPLE_CHARS } from '../samples';

describe('statementPasswords', () => {
  const env = {
    STATEMENT_PASSWORDS_ALICE: JSON.stringify({
      hdfc_card_statement: ['ALIC1234', 'ALIC5678'],
      cdsl_cas: 'ABCDE1234F',
      '*': ['ABCDE1234F'],
    }),
  };

  it("returns the source's own candidates first, then the shared ones, without duplicates", () => {
    expect(statementPasswords('alice', 'hdfc_card_statement', env)).toEqual(['ALIC1234', 'ALIC5678', 'ABCDE1234F']);
    expect(statementPasswords('alice', 'cdsl_cas', env)).toEqual(['ABCDE1234F']);
    expect(statementPasswords('alice', 'nps_protean', env)).toEqual(['ABCDE1234F']);
  });

  it('keeps owners apart and survives a missing or malformed variable', () => {
    expect(statementPasswords('bob', 'cdsl_cas', env)).toEqual([]);
    expect(statementPasswords('alice', 'cdsl_cas', { STATEMENT_PASSWORDS_ALICE: '{not json' })).toEqual([]);
  });
});

describe('redactStatementText', () => {
  it('masks PANs, card and account numbers and emails, keeping the layout', () => {
    const text = 'PAN: ABCDE1234F\nCard 4111 1111 1111 1234\nBO ID 1208160012345678\nalice@example.com\nTotal Due 23,456.00';
    expect(redactStatementText(text)).toBe('PAN: [PAN]\nCard ••1234\nBO ID ••5678\n[email]\nTotal Due 23,456.00');
  });

  it('truncates very long text', () => {
    const long = 'x'.repeat(MAX_SAMPLE_CHARS + 100);
    expect(redactStatementText(long).endsWith('…[truncated]')).toBe(true);
  });
});

describe('passwordHint', () => {
  it('keeps only the sentences about the password', () => {
    const body =
      'Dear Customer, please find your statement attached. The password is the first four letters of your name in capitals followed by your date of birth in DDMM format. Thank you.';
    expect(passwordHint(body)).toBe(
      'The password is the first four letters of your name in capitals followed by your date of birth in DDMM format. Thank you.'
    );
  });

  it('returns null when the email says nothing about a password', () => {
    expect(passwordHint('Please find your statement attached.')).toBeNull();
  });
});
