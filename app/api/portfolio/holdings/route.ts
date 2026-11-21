import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { PortfolioHoldingService } from '@/lib/services/PortfolioHoldingService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioHoldingService(supabase);
    const searchParams = request.nextUrl.searchParams;
    const accountId = searchParams.get('accountId');
    const id = searchParams.get('id');
    const includeInactive = searchParams.get('includeInactive') === 'true';

    if (id) {
      const data = await service.getById(id);
      return NextResponse.json(data ?? null);
    }

    const holdings = await service.list({ accountId: accountId || undefined, includeInactive });
    return NextResponse.json(holdings ?? []);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio holdings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioHoldingService(supabase);
    const body = await request.json();
    const {
      account_id,
      name,
      symbol,
      identifier,
      instrument_type,
      quantity_unit,
      sort_order,
      details,
      is_active,
    } = body;

    if (!account_id || !name || !identifier?.trim()) {
      return NextResponse.json(
        { error: 'account_id, name, and identifier are required' },
        { status: 400 }
      );
    }

    try {
      const created = await service.create({
        account_id,
        name,
        symbol,
        identifier,
        instrument_type,
        quantity_unit,
        sort_order,
        details,
        is_active,
      } as any);
      return NextResponse.json(created, { status: 201 });
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('instrument_type must be one of')) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to create portfolio holding' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioHoldingService(supabase);
    const body = await request.json();
    const {
      id,
      name,
      symbol,
      identifier,
      instrument_type,
      quantity_unit,
      sort_order,
      details,
      is_active,
    } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    try {
      const updated = await service.update(id, {
        name,
        symbol,
        identifier,
        instrument_type,
        quantity_unit,
        sort_order,
        details,
        is_active,
      } as any);
      return NextResponse.json(updated);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('instrument_type must be one of')) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to update portfolio holding' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioHoldingService(supabase);
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    await service.delete(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete portfolio holding' },
      { status: 500 }
    );
  }
}
