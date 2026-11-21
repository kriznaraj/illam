import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { InsightsService } from '@/lib/services/InsightsService';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new InsightsService(supabase);
    
    const body = await request.json();
    const { month } = body; // Optional: specific month to clear
    const result = await service.clearCache(month);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to clear cache' }, { status: 500 });
  }
}
