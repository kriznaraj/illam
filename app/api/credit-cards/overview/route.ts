import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServerClientNoCache } from '@/lib/supabase-server';
import { CreditCardOverviewService } from '@/lib/services/CreditCardOverviewService';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // Use no-cache client if this is a refresh request (has timestamp parameter)
  const isRefresh = url.searchParams.has('t');
  const supabase = isRefresh ? createServerClientNoCache() : createClient();

  const service = new CreditCardOverviewService(supabase);
  const data = await service.getOverview({ month: url.searchParams.get('month') });
  const res = NextResponse.json(data);
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}

