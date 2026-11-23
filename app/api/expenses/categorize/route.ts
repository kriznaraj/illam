import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { logApiError } from '@/lib/utils';
import { CategoryRepository } from '@/lib/repositories/CategoryRepository';
import { ExpenseCategorizationService } from '@/lib/services/ExpenseCategorizationService';
import { isAIEnabled } from '@/lib/ai';

export const dynamic = 'force-dynamic';

/** Whether AI categorisation is available, so the client can decide what to show. */
export async function GET() {
  return NextResponse.json({ aiEnabled: isAIEnabled() });
}

/**
 * Suggest categories for one or many descriptions.
 *
 * Body: { description: string } | { items: { id, description, amount? }[] }
 *
 * Never fails the request because of an AI problem — the service falls back to the
 * offline keyword matcher and reports `source` so the caller knows which path answered.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const body = await request.json().catch(() => ({}));

    const categories = (await new CategoryRepository(supabase).findAllSorted()).map((c) => ({
      id: c.id,
      name: c.name,
      group_name: c.group_name,
    }));

    // Categorisation needs no database access of its own — it works from the category
    // list above plus the AI provider.
    const service = new ExpenseCategorizationService();

    if (Array.isArray(body?.items)) {
      type Item = { id: string; description: string; amount?: number };
      const items: Item[] = body.items
        .filter((i: unknown): i is Item => !!i && typeof (i as { id?: unknown }).id === 'string')
        .slice(0, 500); // bound the request; the backfill script chunks above this
      const map = await service.suggestMany(items, categories);
      return NextResponse.json({
        results: items.map((i: Item) => ({ id: i.id, ...map.get(i.id) })),
        aiEnabled: isAIEnabled(),
      });
    }

    const description = typeof body?.description === 'string' ? body.description : '';
    if (!description.trim()) {
      return NextResponse.json({ error: 'description or items is required' }, { status: 400 });
    }

    return NextResponse.json({
      ...(await service.suggestOne(description, categories)),
      aiEnabled: isAIEnabled(),
    });
  } catch (error) {
    logApiError('Error in expense categorization:', error);
    return NextResponse.json({ error: 'Failed to categorize' }, { status: 500 });
  }
}
