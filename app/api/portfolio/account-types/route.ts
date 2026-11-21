import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { cachedJson } from '@/lib/utils';
import { PortfolioAccountTypeService } from '@/lib/services/PortfolioAccountTypeService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioAccountTypeService(supabase);
    return cachedJson(await service.list(), 'static');
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch account types' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioAccountTypeService(supabase);
    const body = await request.json();
    const { name, color, show_in_growth, is_equity } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const created = await service.create({ name, color, show_in_growth, is_equity });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create account type' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioAccountTypeService(supabase);
    const body = await request.json();
    const { id, name, color, show_in_growth, is_equity } = body;

    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const updated = await service.update(id, { name, color, show_in_growth, is_equity });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: 'Failed to update account type' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioAccountTypeService(supabase);
    const id = request.nextUrl.searchParams.get('id');
    const name = request.nextUrl.searchParams.get('name');

    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    try {
      await service.delete({ id, name });
    } catch (e) {
      if (e instanceof Error && e.message.includes('Cannot delete a type')) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to delete account type' }, { status: 500 });
  }
}
