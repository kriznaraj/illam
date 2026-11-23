import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { CreditCardOverviewService } from '@/lib/services/CreditCardOverviewService';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const service = new CreditCardOverviewService(createServerClientFromRequest(req));
    const data = await service.getOverview({ month: req.nextUrl.searchParams.get('month') });
    const res = NextResponse.json(data);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.headers.set('Pragma', 'no-cache');
    res.headers.set('Expires', '0');
    return res;
  } catch (error) {
    console.error('Error fetching credit card overview:', error);
    return NextResponse.json({ error: 'Failed to fetch credit card overview' }, { status: 500 });
  }
}
