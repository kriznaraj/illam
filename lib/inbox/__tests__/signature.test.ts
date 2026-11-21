// @vitest-environment node
// signature.ts uses Node's crypto. Under the default happy-dom environment Vite
// externalises it as a browser build, which crashes the whole file on Vercel
// ("No such built-in module: node:") while still passing on some local setups.
import { describe, it, expect } from 'vitest';
import { parseOwner, secretForOwner, signPayload, SIGNATURE_WINDOW_SECONDS, verifySignature } from '../signature';

const SECRET = 'k'.repeat(64);
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ messageId: '18f2a3b4c5d6e7f8' });

const signed = (overrides: Partial<Parameters<typeof verifySignature>[0]> = {}) => {
  const timestamp = String(NOW);
  return verifySignature({
    secret: SECRET,
    timestamp,
    signature: signPayload(SECRET, timestamp, BODY),
    body: BODY,
    nowSeconds: NOW,
    ...overrides,
  });
};

describe('verifySignature', () => {
  it('accepts a correctly signed request', () => {
    expect(signed()).toEqual({ ok: true });
  });

  it('rejects a tampered body', () => {
    expect(signed({ body: BODY.replace('18f2', '99f2') })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a signature made with another secret', () => {
    const timestamp = String(NOW);
    expect(signed({ signature: signPayload('x'.repeat(64), timestamp, BODY) })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects timestamps outside the replay window, in either direction', () => {
    expect(signed({ nowSeconds: NOW + SIGNATURE_WINDOW_SECONDS + 1 })).toEqual({ ok: false, reason: 'stale' });
    expect(signed({ nowSeconds: NOW - SIGNATURE_WINDOW_SECONDS - 1 })).toEqual({ ok: false, reason: 'stale' });
    expect(signed({ nowSeconds: NOW + SIGNATURE_WINDOW_SECONDS })).toEqual({ ok: true });
  });

  it('rejects missing headers and garbage signatures without throwing', () => {
    expect(signed({ signature: null })).toEqual({ ok: false, reason: 'missing' });
    expect(signed({ timestamp: null })).toEqual({ ok: false, reason: 'missing' });
    expect(signed({ signature: 'not-hex' })).toEqual({ ok: false, reason: 'mismatch' });
    expect(signed({ timestamp: 'soon' })).toEqual({ ok: false, reason: 'stale' });
  });
});

describe('secretForOwner', () => {
  it("reads each owner's own variable", () => {
    const env = { INBOX_SECRET_ALICE: SECRET, INBOX_SECRET_BOB: 's'.repeat(40) };
    expect(secretForOwner('alice', env)).toBe(SECRET);
    expect(secretForOwner('bob', env)).toBe('s'.repeat(40));
  });

  it('treats a missing or short secret as not configured', () => {
    expect(secretForOwner('alice', {})).toBeNull();
    expect(secretForOwner('alice', { INBOX_SECRET_ALICE: 'short' })).toBeNull();
  });
});

describe('parseOwner', () => {
  it('accepts only the two known owners', () => {
    expect(parseOwner('alice')).toBe('alice');
    expect(parseOwner('bob')).toBe('bob');
    expect(parseOwner('Alice')).toBeNull();
    expect(parseOwner(null)).toBeNull();
  });
});
