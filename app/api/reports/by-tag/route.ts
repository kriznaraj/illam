import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { TagReportService } from '@/lib/services/reports/TagReportService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new TagReportService(supabase);
    
    const searchParams = request.nextUrl.searchParams;
    const tagId = searchParams.get('tagId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!tagId) {
      return NextResponse.json(
        { error: 'Tag ID is required' },
        { status: 400 }
      );
    }

    const result = await service.getTagReport({
      tagId,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tag report' },
      { status: 500 }
    );
  }
}
