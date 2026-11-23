import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { PortfolioAccountService } from '@/lib/services/PortfolioAccountService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioAccountService(supabase);
    
    const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';

    // Accounts are user-editable and change with edits/migrations — never serve stale.
    const res = NextResponse.json(await service.list(includeArchived));
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio accounts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioAccountService(supabase);
    
    const body = await request.json();
    const { name, type, notes, currency, unit, multiplier, sort_order, details } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: 'Missing required fields: name and type are required' },
        { status: 400 }
      );
    }

    const created = await service.create({ name, type, notes, currency, unit, multiplier, details, sort_order } as any);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to create portfolio account' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioAccountService(supabase);
    
    const body = await request.json();
    const { id, name, type, notes, currency, unit, multiplier, is_active, sort_order, details, is_cash } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Account ID is required' },
        { status: 400 }
      );
    }

    const updated = await service.update(id, { name, type, notes, currency, unit, multiplier, is_active, sort_order, details, is_cash } as any);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to update portfolio account' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioAccountService(supabase);
    
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Account ID is required' },
        { status: 400 }
      );
    }

    await service.delete(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete portfolio account' },
      { status: 500 }
    );
  }
}
