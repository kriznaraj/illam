import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { CategoryMonthlyReportService } from '@/lib/services/reports/CategoryMonthlyReportService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new CategoryMonthlyReportService(supabase);
    
    const searchParams = request.nextUrl.searchParams;
    const monthsBack = parseInt(searchParams.get('months') || '12');
    // Family-wide semantics: keep param for backward compatibility, but ignore it.
    void searchParams.get('userId');

    const result = await service.getReport({ monthsBack });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
