import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { CreditCardStatementService } from '@/lib/services/CreditCardStatementService';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const accountId = req.nextUrl.searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });

  const month = req.nextUrl.searchParams.get('month'); // optional yyyy-MM filter
  const service = new CreditCardStatementService(supabase);
  const data = await service.list(accountId, month);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const body = await req.json();
  const service = new CreditCardStatementService(supabase);
  const result = await service.create(body);
  return NextResponse.json(result.body, { status: result.status });
}

export async function PUT(req: NextRequest) {
  const supabase = createClient();
  const body = await req.json();
  const service = new CreditCardStatementService(supabase);
  const result = await service.update(body);
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const id = req.nextUrl.searchParams.get('id');
  const service = new CreditCardStatementService(supabase);
  const result = await service.delete(id || '');
  return NextResponse.json(result.body, { status: result.status });
}
