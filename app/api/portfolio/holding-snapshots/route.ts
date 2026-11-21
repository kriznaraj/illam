import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { PortfolioHoldingSnapshotService } from '@/lib/services/PortfolioHoldingSnapshotService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioHoldingSnapshotService(supabase);
    const searchParams = request.nextUrl.searchParams;
    const holdingId = searchParams.get('holdingId');
    const accountId = searchParams.get('accountId');
    const snapshotDate = searchParams.get('snapshotDate');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const limit = parseInt(searchParams.get('limit') || '5000', 10);
    const rows = await service.list({
      holdingId: holdingId || undefined,
      accountId: accountId || undefined,
      snapshotDate: snapshotDate || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit: Math.min(limit, 50000),
    });

    return NextResponse.json(rows ?? []);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio holding snapshots' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioHoldingSnapshotService(supabase);
    const body = await request.json();
    const { holding_id, snapshot_date, quantity, unit_amount, amount } = body;

    if (!holding_id || !snapshot_date) {
      return NextResponse.json(
        { error: 'holding_id and snapshot_date are required' },
        { status: 400 }
      );
    }

    if (amount === undefined && (quantity === undefined || unit_amount === undefined)) {
      return NextResponse.json(
        { error: 'Either amount or both quantity and unit_amount are required' },
        { status: 400 }
      );
    }

    try {
      const row = await service.upsert({ holding_id, snapshot_date, quantity, unit_amount, amount });
      return NextResponse.json(row, { status: 201 });
    } catch (e) {
      if (e instanceof Error && e.message === 'Either amount or both quantity and unit_amount are required') {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to save portfolio holding snapshot' },
      { status: 500 }
    );
  }
}
