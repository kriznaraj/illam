/**
 * Response schemas for every AI task.
 *
 * These are the contract: the API validates the model's reply against them, so a caller
 * that receives `{ok: true}` has a fully-typed object. Keep them small and flat — the
 * structured-outputs feature does not support recursive schemas, numeric constraints
 * (min/max), or string length constraints, so express those rules in the prompt instead
 * and re-check in code if they matter.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ categorization */

export const CategorySuggestionSchema = z.object({
  /** Must be one of the category names supplied in the prompt, or null. */
  categoryName: z.string().nullable()
    .describe('Exact category name from the provided list, or null if none fit'),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string().describe('One short sentence'),
  /**
   * True when the row is not household spending at all — a savings contribution
   * (chit fund), a transfer, or an imported monthly aggregate. These should be
   * surfaced, not forced into a category.
   */
  notAnExpense: z.boolean(),
});
export type CategorySuggestion = z.infer<typeof CategorySuggestionSchema>;

export const BulkCategorySuggestionSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      categoryName: z.string().nullable(),
      confidence: z.enum(['high', 'medium', 'low']),
      notAnExpense: z.boolean(),
      reasoning: z.string(),
    }),
  ),
});
export type BulkCategorySuggestion = z.infer<typeof BulkCategorySuggestionSchema>;

/* ------------------------------------------------------------------------ receipts */

export const ReceiptExtractionSchema = z.object({
  merchant: z.string().nullable(),
  /** ISO yyyy-MM-dd. Null when the receipt shows no date. */
  date: z.string().nullable().describe('yyyy-MM-dd, or null if not printed'),
  /** Grand total actually paid, in rupees. */
  totalAmount: z.number().nullable(),
  categoryName: z.string().nullable().describe('Exact category name from the provided list'),
  description: z.string().describe('Short human description, e.g. "Groceries at DMart"'),
  lineItems: z.array(z.object({ name: z.string(), amount: z.number() })),
  /** Set when the image is unreadable or clearly not a receipt. */
  unreadable: z.boolean(),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;

/* ------------------------------------------------------------------- CDSL holdings */

/**
 * Mirrors the `ImportRow` shape the existing portfolio import UI already consumes, so the
 * Claude path is a drop-in alternative to the regex parser.
 */
export const HoldingsExtractionSchema = z.object({
  statementDate: z.string().nullable().describe('yyyy-MM-dd, the "as on" date of the statement'),
  holdings: z.array(
    z.object({
      name: z.string(),
      identifier: z.string().describe('ISIN where present, else the folio or scheme code'),
      /** 'stock' for demat equities, 'mf' for mutual-fund units. */
      kind: z.enum(['stock', 'mf']),
      quantity: z.number(),
      unitPrice: z.number().nullable(),
      value: z.number(),
    }),
  ),
});
export type HoldingsExtraction = z.infer<typeof HoldingsExtractionSchema>;

/* ------------------------------------------------------------------------- insights */

/**
 * The wire contract for AI-generated insights.
 *
 * The `type` union must stay a subset of `InsightType` in `types/index.ts`, which is the
 * source of truth the UI and the rule engines share. It deliberately omits
 * 'data_quality', 'performance', 'diversification' and 'projection': those are computed
 * from the database (staleness, sign errors, contribution decomposition), not inferred
 * from a transaction list, so the model is not invited to guess at them.
 */
export const InsightsSchema = z.object({
  insights: z.array(
    z.object({
      type: z.enum(['pattern', 'anomaly', 'trend', 'achievement', 'prediction']),
      severity: z.enum(['info', 'warning', 'danger', 'success']),
      title: z.string(),
      description: z.string(),
      icon: z.string().describe('A single emoji'),
      value: z.number().nullable(),
      change: z.number().nullable().describe('Percentage change'),
      action: z.string().nullable(),
    }),
  ),
});
export type InsightsExtraction = z.infer<typeof InsightsSchema>;

/* ---------------------------------------------------------------- transfer resolution */

/**
 * What a waiting bank transfer was. `quote` is the load-bearing field: the decision is applied
 * without asking only when this exact text is found in the statement line or the history the
 * model was shown (`lib/inbox/automation/claudeResolve.ts`), so a guess cannot pass as evidence.
 */
export const TransferResolutionSchema = z.object({
  kind: z
    .enum(['own_account', 'investment', 'loan', 'card_bill', 'cash', 'tax', 'family', 'other', 'expense', 'income', 'unsure'])
    .describe('What this money movement was; "unsure" when the evidence does not say'),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().describe('One short sentence for the household, citing the evidence'),
  quote: z
    .string()
    .nullable()
    .describe('Verbatim text copied from the STATEMENT LINE or HISTORY that supports the kind, or null'),
});
export type TransferResolution = z.infer<typeof TransferResolutionSchema>;
