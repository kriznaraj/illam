import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { CreditCardStatementService } from '@/lib/services/CreditCardStatementService';

export const dynamic = 'force-dynamic';

/** A thrown service error as JSON: "… must be …" is the caller's fault, anything else is ours. */
function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  console.error(`${fallback}:`, message);
  return NextResponse.json({ error: message }, { status: / must be /.test(message) ? 400 : 500 });
}

export async function GET(req: NextRequest) {
  try {
    const accountId = req.nextUrl.searchParams.get('accountId');
    if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });

    const month = req.nextUrl.searchParams.get('month'); // optional yyyy-MM filter
    const service = new CreditCardStatementService(createServerClientFromRequest(req));
    const data = await service.list(accountId, month);
    return NextResponse.json(data);
  } catch (error) {
    return errorResponse(error, 'Failed to fetch credit card statements');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const service = new CreditCardStatementService(createServerClientFromRequest(req));
    const result = await service.create(body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return errorResponse(error, 'Failed to create credit card statement');
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const service = new CreditCardStatementService(createServerClientFromRequest(req));
    const result = await service.update(body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return errorResponse(error, 'Failed to update credit card statement');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    const service = new CreditCardStatementService(createServerClientFromRequest(req));
    const result = await service.delete(id || '');
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return errorResponse(error, 'Failed to delete credit card statement');
  }
}
