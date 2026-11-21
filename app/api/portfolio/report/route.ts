import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { PortfolioReportService } from '@/lib/services/PortfolioReportService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const searchParams = request.nextUrl.searchParams;
    const monthsBack = parseInt(searchParams.get('months') || '12');
    const accountType = searchParams.get('type');
    const service = new PortfolioReportService(supabase);
    const data = await service.getReport({ monthsBack, accountType: accountType || null });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate portfolio report' },
      { status: 500 }
    );
  }
}
