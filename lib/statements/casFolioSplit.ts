import type { CasFolioHolding } from './cdslCas';

/**
 * Splitting one CAS folio table across several Selvam mutual fund accounts, by
 * the fund names each account lists in `details.funds` (for example, one member's
 * Groww and ET Money accounts). The CAS never says which platform bought a folio,
 * so the fund lists are the only link.
 */

export interface FundList {
  accountId: string;
  funds: readonly string[];
}

export interface FolioSplit {
  byAccount: Map<string, CasFolioHolding[]>;
  /** Scheme names no list names, or more than one list does. */
  unassigned: string[];
}

// Words every scheme name carries, so they say nothing about which fund it is.
const GENERIC = new Set(['fund', 'funds', 'direct', 'plan', 'growth', 'option', 'regular', 'the', 'and', 'of', 'scheme']);

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Whether a fund-list entry names a CAS scheme: every distinctive word of it appears
 * in the scheme name, spaces ignored — "Tech" in "Technology", "Midcap" in "Mid Cap",
 * "Mirae Large & Midcap" in "Mirae Asset Large and Midcap Fund".
 */
export function fundNamesScheme(fund: string, scheme: string): boolean {
  const words = fund
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !GENERIC.has(word));
  const target = squash(scheme);
  return words.length > 0 && words.every((word) => target.includes(word));
}

export function splitFoliosByFund(folios: readonly CasFolioHolding[], lists: readonly FundList[]): FolioSplit {
  const byAccount = new Map<string, CasFolioHolding[]>();
  const unassigned: string[] = [];
  for (const folio of folios) {
    const owners = lists.filter((list) => list.funds.some((fund) => fundNamesScheme(fund, folio.name)));
    if (owners.length !== 1) {
      unassigned.push(folio.name);
      continue;
    }
    const rows = byAccount.get(owners[0].accountId) ?? [];
    rows.push(folio);
    byAccount.set(owners[0].accountId, rows);
  }
  return { byAccount, unassigned };
}
