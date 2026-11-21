import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { PortfolioInsightsService } from '@/lib/services/PortfolioInsightsService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get('month'); // Format: yyyy-MM

    if (!month) {
      return NextResponse.json({ error: 'Month parameter required (yyyy-MM)' }, { status: 400 });
    }

    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioInsightsService(supabase);
    const result = await service.getInsights(month);
    return NextResponse.json(result.body, { status: result.status });

  } catch (error) {
    console.error('Error generating insights:', error);
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 });
  }
}
