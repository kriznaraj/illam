import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { GoldRegisterService } from '@/lib/services/GoldRegisterService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new GoldRegisterService(supabase);
    return NextResponse.json(await service.list());
  } catch {
    return NextResponse.json({ error: 'Failed to fetch gold register' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const body = await request.json();
    const service = new GoldRegisterService(supabase);
    try {
      const data = await service.create(body);
      return NextResponse.json(data, { status: 201 });
    } catch (e) {
      if (e instanceof Error && e.message === 'name and gold_weight are required') {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
  } catch {
    return NextResponse.json({ error: 'Failed to create gold item' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const body = await request.json();
    const service = new GoldRegisterService(supabase);
    try {
      const data = await service.update(body);
      return NextResponse.json(data);
    } catch (e) {
      if (e instanceof Error && e.message === 'id is required') {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
  } catch {
    return NextResponse.json({ error: 'Failed to update gold item' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const service = new GoldRegisterService(supabase);
    await service.delete(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete gold item' }, { status: 500 });
  }
}
