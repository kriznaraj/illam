import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { AnnualReviewService } from '@/lib/services/AnnualReviewService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const result = await new AnnualReviewService(supabase).getReview();
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error building annual review:', error);
    return NextResponse.json({ error: 'Failed to build annual review' }, { status: 500 });
  }
}
