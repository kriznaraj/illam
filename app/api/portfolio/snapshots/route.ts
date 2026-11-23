import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { cachedJson } from '@/lib/utils';
import { PortfolioSnapshotService } from '@/lib/services/PortfolioSnapshotService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioSnapshotService(supabase);
    
    const searchParams = request.nextUrl.searchParams;
    const accountId = searchParams.get('accountId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Default to high limit so dashboard gets full history (Supabase default is 1000, which drops older months)
    const limit = parseInt(searchParams.get('limit') || '10000', 10);
    const data = await service.list({
      accountId: accountId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit: Math.min(limit, 50000),
    });
    // Snapshot reads are used immediately after write/sync flows.
    // Avoid browser caching to prevent stale totals in UI.
    return cachedJson(data, 'realtime');
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch portfolio snapshots' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioSnapshotService(supabase);
    
    const body = await request.json();
    const { account_id, snapshot_date, amount, units } = body;

    if (!account_id || !snapshot_date || amount === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: account_id, snapshot_date, and amount are required' },
        { status: 400 }
      );
    }

    const row = await service.upsert({ account_id, snapshot_date, amount, units });
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to create/update portfolio snapshot' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioSnapshotService(supabase);
    
    const body = await request.json();
    const { id, account_id, snapshot_date, amount } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Snapshot ID is required' },
        { status: 400 }
      );
    }

    const updated = await service.update(id, { account_id, snapshot_date, amount });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to update portfolio snapshot' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioSnapshotService(supabase);
    
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Snapshot ID is required' },
        { status: 400 }
      );
    }

    await service.delete(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete portfolio snapshot' },
      { status: 500 }
    );
  }
}
