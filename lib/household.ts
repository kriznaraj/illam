import { z } from 'zod';
import type { InboxOwner } from '@/types';

/**
 * The household this deployment serves, read from the `ILLAM_HOUSEHOLD` env var (JSON).
 *
 * One deployment serves one household. Each member is an inbox owner: a mailbox that pushes
 * bank mail through the Gmail Apps Script, and the person whose payee names, accounts and
 * statements the inbox automation recognises. See `household.example.json`.
 *
 * Server-side only: client code reads member names through `/api/household`.
 */

const casAccountsSchema = z.union([
  z.object({ demat: z.string(), folios: z.string() }),
  z.object({ demat: z.string(), folioAccounts: z.array(z.string()) }),
]);

const contributionSchema = z.object({
  accountId: z.string(),
  alsoCheck: z.array(z.string()).default([]),
});

const memberSchema = z.object({
  /** Lower-case id used in URLs, env var names (`INBOX_SECRET_<SLUG>`) and the database. */
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'slug must be lower-case letters, digits or _'),
  /** Display name. */
  name: z.string().min(1),
  /** `users.username` this member's expenses belong to. Defaults to the slug. */
  username: z.string().min(1).optional(),
  /** How banks print this person as a payee, upper-case, matched as whole words. */
  payeeNames: z.array(z.string().min(1)).default([]),
  /**
   * Where this member's CDSL CAS goes: `demat` takes everything in the demat account; mutual
   * fund folios go to one account (`folios`) or are split across several by the fund names
   * each lists (`folioAccounts`, see lib/statements/casFolioSplit.ts). Selvam account ids.
   */
  cas: casAccountsSchema.optional(),
  /**
   * The Selvam account each emailed balance statement sets, keyed by
   * `<source id>:<last four digits>` (account number; PRAN for NPS).
   */
  statementAccounts: z.record(z.string(), z.string()).default({}),
  /**
   * Accounts outside the household that a bank statement shows money going into (a broker
   * wallet, a savings scheme), keyed by the destination's last four digits.
   */
  contributionDestinations: z.record(z.string(), contributionSchema).default({}),
});

const householdSchema = z.object({ members: z.array(memberSchema).min(1) });

export type CasAccounts = z.infer<typeof casAccountsSchema>;
export type ContributionDestination = z.infer<typeof contributionSchema>;
export type HouseholdMember = z.infer<typeof memberSchema>;
export type Household = z.infer<typeof householdSchema>;

/** Used when `ILLAM_HOUSEHOLD` is unset: one person, no mapped accounts. */
const DEFAULT_HOUSEHOLD: Household = householdSchema.parse({ members: [{ slug: 'me', name: 'Me' }] });

let cached: { raw: string | undefined; value: Household } | null = null;

export function parseHousehold(raw: string | undefined): Household {
  if (!raw || !raw.trim()) return DEFAULT_HOUSEHOLD;
  const parsed = householdSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`ILLAM_HOUSEHOLD is invalid: ${parsed.error.message}`);
  const slugs = parsed.data.members.map((m) => m.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error('ILLAM_HOUSEHOLD has duplicate member slugs');
  return parsed.data;
}

export function household(env: Record<string, string | undefined> = process.env): Household {
  const raw = env.ILLAM_HOUSEHOLD;
  if (!cached || cached.raw !== raw) cached = { raw, value: parseHousehold(raw) };
  return cached.value;
}

export const members = (): HouseholdMember[] => household().members;
export const memberSlugs = (): InboxOwner[] => members().map((m) => m.slug);
export const isMember = (value: string | null | undefined): value is InboxOwner =>
  !!value && memberSlugs().includes(value);

function member(owner: InboxOwner): HouseholdMember | undefined {
  return members().find((m) => m.slug === owner);
}

export const memberName = (owner: InboxOwner): string => member(owner)?.name ?? owner;
export const ownerUsername = (owner: InboxOwner): string => member(owner)?.username ?? owner;
export const payeeNames = (owner: InboxOwner): string[] => member(owner)?.payeeNames ?? [];
export const otherMembers = (owner: InboxOwner): InboxOwner[] => memberSlugs().filter((slug) => slug !== owner);
export const otherMemberNames = (owner: InboxOwner): string =>
  otherMembers(owner).map(memberName).join(' or ') || 'another member';
export const casAccounts = (owner: InboxOwner): CasAccounts | undefined => member(owner)?.cas;

export function statementAccountIds(): Record<InboxOwner, Record<string, string>> {
  return Object.fromEntries(members().map((m) => [m.slug, m.statementAccounts]));
}

export function contributionDestinations(): Record<InboxOwner, Record<string, ContributionDestination>> {
  return Object.fromEntries(members().map((m) => [m.slug, m.contributionDestinations]));
}

/** "Alice and Bob" — how prompts describe the household. */
export function householdDescription(): string {
  const names = members().map((m) => m.name);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
