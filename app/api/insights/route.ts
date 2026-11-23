import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { InsightsService } from '@/lib/services/InsightsService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new InsightsService(supabase);

    const searchParams = request.nextUrl.searchParams;
    const monthParam = searchParams.get('month'); // Format: YYYY-MM
    const forceRegenerate = searchParams.get('force') === 'true'; // Force LLM regeneration
    const result = await service.getInsights({ monthParam, forceRegenerate });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Insights error:', error);
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 });
  }
}
