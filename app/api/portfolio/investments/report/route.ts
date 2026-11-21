import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { PortfolioInvestmentService } from '@/lib/services/PortfolioInvestmentService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioInvestmentService(supabase);
    const monthsRaw = request.nextUrl.searchParams.get('months');
    const months = monthsRaw ? Number.parseInt(monthsRaw, 10) : 12;
    const report = await service.getReport(Number.isFinite(months) ? months : 12);

    const res = NextResponse.json(report);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build investment report' },
      { status: 500 }
    );
  }
}
