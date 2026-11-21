import { createHmac, timingSafeEqual } from 'crypto';
import type { InboxOwner } from '@/types';
import { isMember } from '@/lib/household';

/**
 * Request signing for POST/GET /api/inbox/ingest — the one API route that has
 * no session, because it is called by a Google Apps Script, not a browser.
 *
 * signature = hex(HMAC-SHA256(secret, `${timestamp}.${body}`))
 *
 * The timestamp bounds replay to a few minutes; ingestion is idempotent on the
 * Gmail message id, so a replay inside the window changes nothing anyway.
 */

export const SIGNATURE_WINDOW_SECONDS = 300;

/** `INBOX_SECRET_<SLUG>`: one secret per household member (lib/household.ts). */
export const ownerSecretEnv = (owner: InboxOwner): string => `INBOX_SECRET_${owner.toUpperCase()}`;

/** Shorter secrets are refused outright: a guessable one would make the route public. */
const MIN_SECRET_LENGTH = 32;

export function parseOwner(value: string | null | undefined): InboxOwner | null {
  return isMember(value) ? value : null;
}

export function secretForOwner(
  owner: InboxOwner,
  env: Record<string, string | undefined> = process.env
): string | null {
  const secret = env[ownerSecretEnv(owner)];
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'stale' | 'mismatch' };

export function verifySignature(params: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
}): SignatureCheck {
  const { secret, timestamp, signature, body } = params;
  if (!timestamp || !signature) return { ok: false, reason: 'missing' };

  const ts = Number(timestamp);
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(ts) || Math.abs(now - ts) > SIGNATURE_WINDOW_SECONDS) {
    return { ok: false, reason: 'stale' };
  }

  const expected = Buffer.from(signPayload(secret, timestamp, body), 'hex');
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true };
}
