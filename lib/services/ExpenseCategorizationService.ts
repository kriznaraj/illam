import { BaseService } from './BaseService';
import { getProvider } from '@/lib/ai';
import { CategorySuggestionSchema, BulkCategorySuggestionSchema } from '@/lib/ai/schemas';
import { matchCategoryByKeyword } from '@/lib/expenses/categoryMatcher';

export type CategoryOption = { id: string; name: string; group_name?: string };

export type Suggestion = {
  categoryId: string | null;
  categoryName: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Where the answer came from — surfaced in the API response so the UI can be honest. */
  source: 'ai' | 'keyword' | 'none';
  reasoning?: string;
  /**
   * The row is not household spending — a chit-fund contribution, a transfer, or an
   * imported monthly aggregate. Surfaced rather than forced into a category.
   */
  notAnExpense?: boolean;
};

const SYSTEM = `You categorise expenses for an Indian household's personal finance app.
You will be given a list of allowed category names and one or more expense descriptions.

Rules:
- Choose ONLY from the allowed category names. Never invent one.
- Descriptions are terse and often Tanglish (Tamil written in English) — e.g. "pani poori"
  is a snack, "maalai" is a flower garland, "moi" is a wedding cash gift, "seer" is a
  ceremonial gift, "annadhanam" is a temple food donation.
- If the row is not household spending at all, set notAnExpense=true and categoryName=null.
  This covers chit-fund contributions ("chit", "chittu", "seetu"), transfers between own
  accounts, and bookkeeping rows such as "Monthly total for <month>".
- If nothing fits, return categoryName=null rather than guessing a catch-all.
- Keep reasoning to one short sentence.`;

export class ExpenseCategorizationService extends BaseService {
  /**
   * Suggest a category for one description.
   *
   * Always returns a usable answer: the offline keyword matcher is consulted first so
   * there is a baseline, then AI is tried and preferred when it succeeds. Any AI failure
   * (no key, rate limit, timeout, refusal, bad schema) silently keeps the keyword result.
   */
  async suggestOne(description: string, categories: CategoryOption[]): Promise<Suggestion> {
    const keyword = matchCategoryByKeyword(description, categories);
    const fallback: Suggestion = keyword
      ? {
          categoryId: keyword.categoryId,
          categoryName: keyword.categoryName,
          confidence: 'low',
          source: 'keyword',
          reasoning: `Matched keyword "${keyword.keyword}"`,
        }
      : { categoryId: null, categoryName: null, confidence: 'low', source: 'none' };

    const provider = getProvider();
    if (!provider.isConfigured() || !description?.trim()) return fallback;

    const result = await provider.complete({
      task: 'classify-expense',
      schema: CategorySuggestionSchema,
      schemaName: 'category_suggestion',
      system: SYSTEM,
      prompt: `Allowed categories:\n${categories.map((c) => `- ${c.name}`).join('\n')}\n\nExpense description: "${description}"`,
    });

    if (!result.ok) {
      this.warn('suggestOne', `AI categorisation unavailable (${result.error.kind}): ${result.error.message} — using keyword match`);
      return fallback;
    }

    const resolved = this.resolveName(result.data.categoryName, categories);
    // The model returned a name that is not in the list — treat as no answer, keep fallback.
    if (result.data.categoryName && !resolved) {
      this.warn('suggestOne', `AI returned unknown category "${result.data.categoryName}"`);
      return fallback;
    }

    return {
      categoryId: resolved?.id ?? null,
      categoryName: resolved?.name ?? null,
      confidence: result.data.confidence,
      source: 'ai',
      reasoning: result.data.reasoning,
      notAnExpense: result.data.notAnExpense,
    };
  }

  /**
   * Categorise many rows in a single request.
   *
   * Deliberately one call rather than the Batches API: at the scale this app operates
   * (tens of rows) a batch job's polling and 24h SLA costs more than it saves, and the
   * whole set fits comfortably in one prompt.
   */
  async suggestMany(
    items: { id: string; description: string; amount?: number }[],
    categories: CategoryOption[],
  ): Promise<Map<string, Suggestion>> {
    const out = new Map<string, Suggestion>();

    // Baseline for every row first, so a total AI failure still improves on nothing.
    for (const item of items) {
      const kw = matchCategoryByKeyword(item.description, categories);
      out.set(
        item.id,
        kw
          ? {
              categoryId: kw.categoryId,
              categoryName: kw.categoryName,
              confidence: 'low',
              source: 'keyword',
              reasoning: `Matched keyword "${kw.keyword}"`,
            }
          : { categoryId: null, categoryName: null, confidence: 'low', source: 'none' },
      );
    }

    const provider = getProvider();
    if (!provider.isConfigured() || items.length === 0) return out;

    const result = await provider.complete({
      task: 'classify-expense',
      schema: BulkCategorySuggestionSchema,
      schemaName: 'bulk_category_suggestion',
      system: SYSTEM,
      // Category list is identical across bulk runs, so it goes in the cacheable prefix.
      cachePrefix: `Allowed categories:\n${categories.map((c) => `- ${c.name}`).join('\n')}`,
      prompt:
        `Categorise each expense below. Return one result per id, preserving the ids exactly.\n\n` +
        items
          .map((i) => `- id: ${i.id}\n  description: "${i.description}"${i.amount != null ? `\n  amount: ₹${i.amount}` : ''}`)
          .join('\n'),
      // Bulk output scales with row count; give it room so it is not truncated.
      maxTokens: Math.min(32_000, 2_000 + items.length * 120),
      timeoutMs: 120_000,
    });

    if (!result.ok) {
      this.warn('suggestMany', `AI categorisation unavailable (${result.error.kind}): ${result.error.message} — keyword results only`);
      return out;
    }

    for (const row of result.data.results) {
      if (!out.has(row.id)) continue; // ignore ids we did not ask about
      const resolved = this.resolveName(row.categoryName, categories);
      if (row.categoryName && !resolved) continue; // unknown name — keep the keyword result
      out.set(row.id, {
        categoryId: resolved?.id ?? null,
        categoryName: resolved?.name ?? null,
        confidence: row.confidence,
        source: 'ai',
        reasoning: row.reasoning,
        notAnExpense: row.notAnExpense,
      });
    }

    return out;
  }

  /** Resolve a model-supplied name to a real category. Never trusts the model's spelling. */
  private resolveName(name: string | null, categories: CategoryOption[]): CategoryOption | null {
    if (!name) return null;
    const target = name.trim().toLowerCase();
    return categories.find((c) => c.name.toLowerCase() === target) ?? null;
  }
}
