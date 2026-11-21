import type { Expense, Tag } from '@/types';
import { isUndecidedCategory } from './merchantHistory';

/**
 * The shared label stamped on every expense the app created for you rather than one you
 * typed — a bank alert through Madal, or a line off a card statement (migration 036).
 *
 * It is provenance, not a to-do: it stays on the row after you confirm it, so months later
 * "where did this come from?" is answerable, and so the list can be filtered down to
 * everything the household never entered by hand. The separate `needs_review` flag is the
 * to-do, and that one clears.
 */
export const AUTO_TAG_NAME = 'auto';

/** Amber, matching the review chip — the two always appear together on a fresh row. */
export const AUTO_TAG_COLOR = '#f59e0b';

export function isAutoTag(tag: Pick<Tag, 'name'>): boolean {
  return tag.name.toLowerCase() === AUTO_TAG_NAME;
}

/**
 * Whether this row was machine-made. Reads the label when it is loaded and falls back to
 * `source`, because the label is missing on rows written before 036 was applied and on
 * anything created while the tag lookup was failing — provenance is still knowable there.
 */
export function isAutoExpense(expense: Pick<Expense, 'source'> & { tags?: Tag[] | null }): boolean {
  if (expense.tags?.some(isAutoTag)) return true;
  return expense.source === 'inbox' || expense.source === 'statement';
}

/**
 * Whether an auto-added expense is waiting on a *decision*, not merely unlooked-at.
 *
 * `needs_review` still means "nobody has touched this row" — the hand-entry merge and the
 * category history both depend on that — but most such rows need nothing: they were filed
 * from this household's own past answer for the payee, or from the keyword table. Asking a
 * person to tick each one creates a pile nobody will work through: confirming every email is
 * not realistic, so only conflicts need review. The conflict is a row automation could not
 * place, which is the one that landed in Miscellaneous. Any edit then confirms it.
 */
export function awaitsDecision(expense: Pick<Expense, 'needs_review'> & { category?: { name?: string | null } | null }): boolean {
  return expense.needs_review === true && isUndecidedCategory(expense.category?.name);
}

/** The labels worth drawing as chips: `auto` is shown by its own badge, never twice. */
export function displayTags(tags: Tag[] | null | undefined): Tag[] {
  return (tags ?? []).filter((tag) => !isAutoTag(tag));
}
