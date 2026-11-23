import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { CommitmentService } from '@/lib/services/CommitmentService';

export const dynamic = 'force-dynamic';

const status = (message: string) => (/ is required| must |already recorded/.test(message) ? 400 : 500);

/** Mark a due month paid by hand — a premium paid from an account no statement reaches. */
export async function POST(request: NextRequest) {
  try {
    const payment = await new CommitmentService(createServerClientFromRequest(request)).markPaid(await request.json());
    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record the payment';
    console.error('Error recording commitment payment:', message);
    return NextResponse.json({ error: message }, { status: status(message) });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    await new CommitmentService(createServerClientFromRequest(request)).removePayment(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove the payment';
    console.error('Error removing commitment payment:', message);
    return NextResponse.json({ error: message }, { status: status(message) });
  }
}
