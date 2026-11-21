import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../email';

describe('normalizeEmail', () => {
  it('drops the whitespace a keyboard or autocomplete leaves around an email', () => {
    expect(normalizeEmail('alice@example.com ')).toBe('alice@example.com');
    expect(normalizeEmail('  alice@example.com\t')).toBe('alice@example.com');
  });

  it('compares emails case-insensitively', () => {
    expect(normalizeEmail('Alice@Example.COM')).toBe('alice@example.com');
  });
});
