import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { CommitmentService } from '@/lib/services/CommitmentService';
import { monthKeys } from '@/lib/utils/dateUtils';

export const dynamic = 'force-dynamic';

/** A 400 is the caller's fault; the service signals that with "… is required" / "… must …". */
const status = (message: string) => (/ is required| must |not found|already recorded/.test(message) ? 400 : 500);
const fail = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback;
  console.error(`${fallback}:`, message);
  return NextResponse.json({ error: message }, { status: status(message) });
};

/** Every commitment, with five years of payments — the longest period — so the list can show what was seen. */
export async function GET(request: NextRequest) {
  try {
    const service = new CommitmentService(createServerClientFromRequest(request));
    const current = monthKeys.current();
    const [commitments, payments] = await Promise.all([
      service.list(),
      service.listPayments(monthKeys.shift(current, -60), monthKeys.shift(current, 12)),
    ]);
    return NextResponse.json({ commitments, payments }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return fail(error, 'Failed to fetch commitments');
  }
}

export async function POST(request: NextRequest) {
  try {
    const service = new CommitmentService(createServerClientFromRequest(request));
    const created = await service.create(await request.json());
    // A premium already recorded as an expense becomes this commitment's payment.
    const moved = await service.claimRecordedExpenses().catch(() => 0);
    return NextResponse.json({ ...created, movedExpenses: moved }, { status: 201 });
  } catch (error) {
    return fail(error, 'Failed to save the commitment');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { id, ...changes } = await request.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const service = new CommitmentService(createServerClientFromRequest(request));
    const updated = await service.update(id, changes);
    const moved = await service.claimRecordedExpenses().catch(() => 0);
    return NextResponse.json({ ...updated, movedExpenses: moved });
  } catch (error) {
    return fail(error, 'Failed to update the commitment');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    await new CommitmentService(createServerClientFromRequest(request)).remove(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, 'Failed to delete the commitment');
  }
}
