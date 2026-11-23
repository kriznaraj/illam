import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { logApiError } from '@/lib/utils';
import { CategoryRepository } from '@/lib/repositories/CategoryRepository';
import { getProvider, isAIEnabled } from '@/lib/ai';
import { ReceiptExtractionSchema } from '@/lib/ai/schemas';
import { getTodayAppDate } from '@/lib/utils/dateUtils';

export const dynamic = 'force-dynamic';
// Images are sent as base64; the default body limit is too small.
export const maxDuration = 60;

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 8 * 1024 * 1024;

/** Lets the client hide the scan button entirely when no key is configured. */
export async function GET() {
  return NextResponse.json({ aiEnabled: isAIEnabled() });
}

/**
 * Read a receipt photo into a draft expense.
 *
 * Returns a DRAFT only — the caller prefills the normal add-expense form and the user
 * confirms. Nothing is written to the database here, so a misread number can never
 * silently become a transaction.
 *
 * The image is not stored. There is no storage bucket, and with RLS disabled a public
 * receipts bucket would expose them; persistence should land with the RLS work.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isAIEnabled()) {
      return NextResponse.json(
        { error: 'Receipt scanning is not configured', aiEnabled: false },
        { status: 503 },
      );
    }

    const form = await request.formData();
    const file = form.get('image');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'An image file is required' }, { status: 400 });
    }
    if (!ACCEPTED.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported image type ${file.type || '(unknown)'}` },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image is larger than 8MB' }, { status: 413 });
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');

    const supabase = createServerClientFromRequest(request);
    const categories = await new CategoryRepository(supabase).findAllSorted();

    const result = await getProvider().complete({
      task: 'extract-receipt',
      schema: ReceiptExtractionSchema,
      schemaName: 'receipt_extraction',
      system:
        'You read photographs of receipts from Indian shops and restaurants and return ' +
        'structured data. Amounts are in rupees. Be conservative: if a value is not clearly ' +
        'legible, return null rather than guessing — a wrong amount is worse than a blank one.',
      prompt:
        `Today's date is ${getTodayAppDate()} (Asia/Kolkata); use it only to resolve ` +
        `relative or two-digit years, never as the receipt date itself.\n\n` +
        `Allowed categories (choose the closest, or null):\n` +
        categories.map((c) => `- ${c.name}`).join('\n') +
        `\n\nExtract the receipt in this image. totalAmount must be the grand total actually ` +
        `paid, not a subtotal. If the image is not a readable receipt, set unreadable=true.`,
      images: [{ mediaType: file.type, base64 }],
    });

    if (!result.ok) {
      // Degrade rather than fail: the client falls back to manual entry.
      // Log the full reason server-side; a billing or key problem is otherwise invisible.
      console.warn(`[receipt] extraction failed (${result.error.kind}): ${result.error.message}`);
      const status =
        result.error.kind === 'rate_limit' ? 429 : result.error.kind === 'auth' ? 503 : 502;
      const message =
        result.error.kind === 'auth'
          ? 'Receipt scanning is unavailable — check the Anthropic API key and credit balance.'
          : `Could not read the receipt (${result.error.kind})`;
      return NextResponse.json({ error: message, kind: result.error.kind }, { status });
    }

    if (result.data.unreadable) {
      return NextResponse.json(
        { error: 'That image could not be read as a receipt', kind: 'unreadable' },
        { status: 422 },
      );
    }

    const matched = result.data.categoryName
      ? categories.find((c) => c.name.toLowerCase() === result.data.categoryName!.toLowerCase())
      : undefined;

    return NextResponse.json({
      draft: {
        amount: result.data.totalAmount,
        date: result.data.date ?? getTodayAppDate(),
        description: result.data.description || result.data.merchant || '',
        merchant: result.data.merchant,
        categoryId: matched?.id ?? null,
        categoryName: matched?.name ?? null,
        lineItems: result.data.lineItems,
      },
      usage: result.usage,
    });
  } catch (error) {
    logApiError('Error scanning receipt:', error);
    return NextResponse.json({ error: 'Failed to scan receipt' }, { status: 500 });
  }
}
