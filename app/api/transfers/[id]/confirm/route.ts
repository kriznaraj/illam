import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { TransferService, type TransferDecision } from '@/lib/services/TransferService';

export const dynamic = 'force-dynamic';

/** Classify a transfer: what the money was for, and optionally remember the payee. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const service = new TransferService(createServerClientFromRequest(request));
    const decision = (await request.json()) as TransferDecision;
    const result = await service.confirm(params.id, decision);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to confirm transfer';
    console.error('Error confirming transfer:', message);
    const status = / must be | is required|already (confirmed|linked|claimed)|needs migration/.test(message)
      ? 400
      : message === 'Transfer not found'
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
