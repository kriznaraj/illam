import type { InboxOwner } from '@/types';
import { passwordShape } from './pdfDiagnostics';

/**
 * Statement PDF passwords live only in the server's environment — never in the
 * database and never in the Apps Script.
 *
 *   STATEMENT_PASSWORDS_ALICE={"cdsl_cas":["ABCDE1234F"],"hdfc_card_statement":["…","…"],"*":["…"]}
 *
 * Keys are source ids from lib/inbox/sources.ts. Each value is a list, because
 * one bank can issue several cards with different passwords; "*" is tried for
 * every source after its own list.
 */

/** `STATEMENT_PASSWORDS_<SLUG>`: one JSON map per household member (lib/household.ts). */
const ownerEnv = (owner: InboxOwner): string => `STATEMENT_PASSWORDS_${owner.toUpperCase()}`;

const asList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []).filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  );

/**
 * Which sources have passwords configured for an owner — keys only, never
 * values. Lets the script (and a person debugging) see why a statement stays
 * locked without anyone reading the secrets.
 */
export function configuredPasswordSources(
  owner: InboxOwner,
  env: Record<string, string | undefined> = process.env
): { configured: boolean; valid: boolean; sources: string[]; shapes: Record<string, string[]> } {
  const raw = env[ownerEnv(owner)];
  if (!raw) return { configured: false, valid: false, sources: [], shapes: {} };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sources = Object.keys(parsed).filter((key) => asList(parsed[key]).length > 0);
    // Length and character classes only: enough to tell whether the deployed value is
    // the one someone typed, without the value itself.
    const shapes = Object.fromEntries(sources.map((key) => [key, asList(parsed[key]).map(passwordShape)]));
    return { configured: true, valid: true, sources, shapes };
  } catch {
    return { configured: true, valid: false, sources: [], shapes: {} };
  }
}

export function statementPasswords(
  owner: InboxOwner,
  sourceId: string,
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = env[ownerEnv(owner)];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return [...new Set([...asList(parsed[sourceId]), ...asList(parsed['*'])])];
  } catch {
    // A malformed value must not take ingestion down; it just unlocks nothing.
    return [];
  }
}
