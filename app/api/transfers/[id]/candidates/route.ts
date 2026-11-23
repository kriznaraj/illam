import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { TransferService } from '@/lib/services/TransferService';

export const dynamic = 'force-dynamic';

/**
 * For an investment transfer: the account it most likely went to, and the contributions it may
 * already be on record as (?account_id= to check a specific account).
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const service = new TransferService(createServerClientFromRequest(request));
    const result = await service.candidates(params.id, request.nextUrl.searchParams.get('account_id'));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load candidates';
    console.error('Error loading transfer candidates:', message);
    const status = / must be |invalid/i.test(message) ? 400 : message === 'Transfer not found' ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
