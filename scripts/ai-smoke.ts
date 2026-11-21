/**
 * One live call per AI task, with synthetic inputs, to prove each path works against the real
 * API: the key, the model ids, the per-model parameter rules and the response schemas.
 * Read-only — nothing touches the database.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/ai-smoke.ts
 *   ... --task classify-expense      # just one task
 *
 * Costs a fraction of a cent per run. Exits non-zero if any task fails.
 */
import { getProvider, isAIEnabled, TASKS } from '../lib/ai';
import type { CompletionRequest, Result, Task } from '../lib/ai';
import {
  CategorySuggestionSchema,
  HoldingsExtractionSchema,
  InsightsSchema,
  ReceiptExtractionSchema,
  TransferResolutionSchema,
} from '../lib/ai/schemas';
import { buildResolvePrompt, resolveSystem } from '../lib/inbox/automation/claudeResolve';
import type { Transfer } from '../types';
import { buildTestPdf } from '../lib/statements/__tests__/testPdf';

/** USD per million tokens, input / output — prompts under 100K tokens. */
const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
};

// A blank 64x64 white PNG: not a receipt, so a working path answers `unreadable: true`.
// (A 1x1 image is rejected outright by the API as "Could not process image".)
const BLANK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3PMQ0AMAzAsPInvYLYYVWKESTzjhsd8KsBrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BbQHKU9LC7/CP1AAAAABJRU5ErkJggg==';

const CATEGORIES = ['Mobile & Broadband', 'Groceries & Staples', 'Dining Out', 'Fuel', 'Miscellaneous'];

const REQUESTS: Record<Task, () => CompletionRequest<unknown>> = {
  'classify-expense': () => ({
    task: 'classify-expense',
    schema: CategorySuggestionSchema,
    schemaName: 'category_suggestion',
    system: 'You categorise household expenses for an Indian family. Pick exactly one category name from the list.',
    prompt: `Allowed categories:\n${CATEGORIES.map((c) => `- ${c}`).join('\n')}\n\nExpense description: "AIRTEL"`,
  }),
  'extract-receipt': () => ({
    task: 'extract-receipt',
    schema: ReceiptExtractionSchema,
    schemaName: 'receipt_extraction',
    system: 'You read shop receipts. Set unreadable to true if the image is not a receipt.',
    prompt: `Extract the receipt. Allowed categories: ${CATEGORIES.join(', ')}.`,
    images: [{ mediaType: 'image/png', base64: BLANK_PNG }],
  }),
  'extract-holdings': () => ({
    task: 'extract-holdings',
    schema: HoldingsExtractionSchema,
    schemaName: 'holdings_extraction',
    system: 'You read CDSL Consolidated Account Statement (CAS) PDFs and return every holding. Amounts are in rupees.',
    prompt: 'Extract all holdings. Use kind="stock" for demat equities and kind="mf" for mutual fund units.',
    documents: [
      {
        mediaType: 'application/pdf',
        base64: buildTestPdf([
          'CDSL Consolidated Account Statement as on 30-09-2026',
          'Demat holdings',
          'INE002A01018 RELIANCE INDUSTRIES LTD 10 2950.00 29500.00',
          'Mutual fund units',
          'INF179K01BB8 HDFC FLEXI CAP FUND 120.500 1850.0000 222925.00',
        ]).toString('base64'),
      },
    ],
  }),
  'resolve-transfer': () => ({
    task: 'resolve-transfer',
    schema: TransferResolutionSchema,
    schemaName: 'transfer_resolution',
    system: resolveSystem('Alice and Bob'),
    prompt: buildResolvePrompt({
      transfer: {
        id: 't-smoke',
        owner: 'alice',
        date: '2026-09-08',
        amount: 25000,
        direction: 'debit',
        counterparty: null,
        payment_method: 'HDFC Bank account ••3101',
        note: 'Statement: NEFT DR-HDFC0000001-BOB K-NETBANK, MUM-N251ABC Value Dt 08/09/2026',
        status: 'needs_review',
        kind: 'other',
      } as Transfer,
      ownerName: 'Alice',
      householdNames: ['ALICE', 'BOB'],
      commitments: [],
      history: ['2026-08-08 | -₹25,000 | HDFC Bank account ••3101 | filed as: family | note: Statement: NEFT DR-…-BOB K-NETBANK'],
    }),
  }),
  insights: () => ({
    task: 'insights',
    schema: InsightsSchema,
    schemaName: 'spending_insights',
    system: 'You are a financial analyst for an Indian household. Never invent figures. Amounts are in rupees.',
    prompt:
      'Generate 2 insights for 2026-09.\nTotal spent: ₹84,200 (August ₹71,900).\n' +
      'Dining Out ₹9,800 (3-month average ₹5,100). Groceries & Staples ₹14,200 (average ₹14,600).',
  }),
};

function costUsd(model: string, input: number, output: number): string {
  const price = PRICES[model];
  if (!price) return '?';
  return `$${((input * price[0] + output * price[1]) / 1_000_000).toFixed(5)}`;
}

async function main() {
  if (!isAIEnabled()) {
    console.error('ANTHROPIC_API_KEY is not set.');
    process.exit(1);
  }
  const only = process.argv.includes('--task') ? process.argv[process.argv.indexOf('--task') + 1] : null;
  const tasks = (Object.keys(REQUESTS) as Task[]).filter((t) => !only || t === only);

  let failed = 0;
  for (const task of tasks) {
    const started = Date.now();
    const result: Result<unknown> = await getProvider().complete(REQUESTS[task]());
    const ms = Date.now() - started;
    if (result.ok) {
      const { model, inputTokens, outputTokens } = result.usage;
      console.log(`✓ ${task}  ${model}  ${ms}ms  in=${inputTokens} out=${outputTokens}  ~${costUsd(model, inputTokens, outputTokens)}`);
      console.log(`  ${JSON.stringify(result.data).slice(0, 400)}`);
    } else {
      failed++;
      console.log(`✗ ${task}  ${TASKS[task].model}  ${ms}ms  ${result.error.kind}: ${result.error.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
