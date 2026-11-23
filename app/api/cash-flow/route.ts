import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { CashFlowService } from '@/lib/services/CashFlowService';
import { monthKeys } from '@/lib/utils/dateUtils';

export const dynamic = 'force-dynamic';

/** A 400 is the caller's fault; the service signals that with "… must be …". */
const status = (message: string) => (/ must | is required/.test(message) ? 400 : 500);

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const current = monthKeys.current();
    const report = await new CashFlowService(createServerClientFromRequest(request)).build(
      params.get('from') ?? current,
      params.get('to') ?? params.get('from') ?? current
    );
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build the cash flow';
    console.error('Error building cash flow:', message);
    return NextResponse.json({ error: message }, { status: status(message) });
  }
}
