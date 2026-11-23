import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { IncomeService } from '@/lib/services/IncomeService';
import { monthKeys } from '@/lib/utils/dateUtils';

export const dynamic = 'force-dynamic';

/** A 400 is the caller's fault; the service signals that with "… is required" / "… must be …". */
const status = (message: string) => (/ is required| must be /.test(message) ? 400 : 500);

export async function GET(request: NextRequest) {
  try {
    const service = new IncomeService(createServerClientFromRequest(request));
    const params = request.nextUrl.searchParams;
    const month = params.get('month') ?? monthKeys.current();
    const rows = await service.listByMonth(month);
    return NextResponse.json(
      { income: rows, summary: service.summarise(rows, month) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch income';
    console.error('Error fetching income:', message);
    return NextResponse.json({ error: message }, { status: status(message) });
  }
}

export async function POST(request: NextRequest) {
  try {
    const service = new IncomeService(createServerClientFromRequest(request));
    const created = await service.create(await request.json());
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record income';
    console.error('Error recording income:', message);
    return NextResponse.json({ error: message }, { status: status(message) });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const service = new IncomeService(createServerClientFromRequest(request));
    const { id, ...changes } = await request.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    return NextResponse.json(await service.update(id, changes));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update income';
    console.error('Error updating income:', message);
    return NextResponse.json({ error: message }, { status: status(message) });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    await new IncomeService(createServerClientFromRequest(request)).remove(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete income';
    console.error('Error deleting income:', message);
    return NextResponse.json({ error: message }, { status: status(message) });
  }
}
