/**
 * What this household has already decided a payee is.
 *
 * Keywords alone would file anything the keyword table does not recognise as Miscellaneous,
 * and the person would set it again on every repeat visit. An earlier *confirmed* expense from
 * the same payee (a snack shop filed under Quick bites, a pharmacy under Healthcare) is a
 * better answer.
 *
 * Deterministic, and no AI — this is the household's own past decision read back.
 */

export interface PriorExpense {
  date: string;
  merchant: string | null;
  description: string | null;
  category_id: string;
  category_name: string;
  needs_review: boolean;
}

export interface MerchantCategory {
  categoryId: string;
  categoryName: string;
  /** Confirmed expenses from this payee that agreed on it — shown as the reason. */
  count: number;
  /** The most recent of those, so the UI can say when it was last decided. */
  lastUsed: string;
}

/**
 * Categories that mean "not decided yet", so a row filed under one teaches nothing. Without
 * this the fallback would feed itself: every unrecognised payee is auto-filed under
 * Miscellaneous, and the next visit would read that back as an answer.
 */
const UNDECIDED = new Set(['miscellaneous', 'other', 'uncategorized', 'uncategorised']);

/** Whether a category name means "nobody has decided where this goes". */
export function isUndecidedCategory(name: string | null | undefined): boolean {
  return UNDECIDED.has(String(name ?? '').trim().toLowerCase());
}

/** Payees are printed inconsistently — "Ramasamy", "RAMASAMY  " — but not *differently*. */
export function normaliseMerchant(value: string | null | undefined): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:\-]+$/, '')
    .trim();
}

/**
 * The category to file a spend from `merchant` under, judged only on expenses the person has
 * confirmed. Most-agreed wins and the most recent breaks a tie: payees do drift (ANNAPOORNA
 * BHAVAN is both Dining Out and Groceries), so the answer is "what you usually say", falling
 * back to "what you said last".
 *
 * Returns null when there is no evidence — the caller then tries keywords, as before. An
 * unconfirmed row is never evidence, whoever created it.
 */
export function categoryFromHistory(merchant: string | null, prior: readonly PriorExpense[]): MerchantCategory | null {
  const key = normaliseMerchant(merchant);
  if (key.length < 3) return null;

  const agreed = new Map<string, MerchantCategory>();
  for (const row of prior) {
    if (row.needs_review) continue;
    if (isUndecidedCategory(row.category_name)) continue;
    // The payee is on `merchant`, or — for rows typed in by hand before Madal existed — is
    // the description itself.
    if (normaliseMerchant(row.merchant) !== key && normaliseMerchant(row.description) !== key) continue;

    const seen = agreed.get(row.category_id);
    if (seen) {
      seen.count += 1;
      if (row.date > seen.lastUsed) seen.lastUsed = row.date;
    } else {
      agreed.set(row.category_id, {
        categoryId: row.category_id,
        categoryName: row.category_name,
        count: 1,
        lastUsed: row.date,
      });
    }
  }

  return (
    [...agreed.values()].sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed))[0] ?? null
  );
}
