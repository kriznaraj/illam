import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { ExpenseService } from '@/lib/services/ExpenseService';

export const dynamic = 'force-dynamic';

/**
 * Where a spend from this payee probably belongs — what the household confirmed for it before,
 * else the offline keyword table. No AI, so it answers with no API key.
 */
export async function GET(request: NextRequest) {
  try {
    const merchant = request.nextUrl.searchParams.get('merchant') ?? '';
    if (!merchant.trim()) return NextResponse.json({ suggestion: null });

    const service = new ExpenseService(createServerClientFromRequest(request));
    return NextResponse.json(
      { suggestion: await service.suggestCategory(merchant) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to suggest a category';
    console.error('Error suggesting a category:', message);
    // A suggestion is a convenience: the caller shows an empty field rather than an error.
    return NextResponse.json({ suggestion: null, error: message }, { status: 200 });
  }
}
