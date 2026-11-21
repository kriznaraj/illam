import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest, createServerClientNoCache } from '@/lib/supabase-server';
import { logApiError } from '@/lib/utils';
import { HomeStatsService } from '@/lib/services/HomeStatsService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    // Use no-cache client if this is a refresh request
    const isRefresh = url.searchParams.has('t');
    const supabase = isRefresh ? createServerClientNoCache() : createServerClientFromRequest(request);
    const service = new HomeStatsService(supabase);
    const response = NextResponse.json(await service.getHomeStats(new Date()));

    // Data changes at most a few times a day — cache 1 min, serve stale for 5 min while revalidating
    response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
    return response;
  } catch (error) {
    logApiError('Error in home-stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch home stats' },
      { status: 500 }
    );
  }
}
