import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { PortfolioInvestmentService } from '@/lib/services/PortfolioInvestmentService';
import { TransferService } from '@/lib/services/TransferService';

export const dynamic = 'force-dynamic';

const parseApiError = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioInvestmentService(supabase);
    const limitRaw = request.nextUrl.searchParams.get('limit');
    const startDate = request.nextUrl.searchParams.get('startDate') ?? undefined;
    const endDate = request.nextUrl.searchParams.get('endDate') ?? undefined;
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 100;
    const items = await service.list({
      limit: Number.isFinite(limit) ? limit : 100,
      startDate,
      endDate,
    });

    const res = NextResponse.json(items);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (error) {
    return NextResponse.json(
      { error: parseApiError(error, 'Failed to fetch investments') },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioInvestmentService(supabase);
    const body = await request.json();
    const { account_id, investment_date, amount, kind, note, force } = body;

    if (!account_id || !investment_date || !Number.isFinite(Number(amount)) || Number(amount) === 0) {
      return NextResponse.json(
        { error: 'account_id, investment_date and non-zero amount are required' },
        { status: 400 }
      );
    }

    // One money record per movement: a deposit already recorded from its bank debit is not
    // typed in again unless the person says it really is a second one.
    if (!force) {
      const recorded = await new TransferService(supabase).findRecordedTransfer(account_id, investment_date, Number(amount));
      if (recorded) {
        return NextResponse.json(
          {
            error: `Already recorded from the ₹${Number(recorded.amount).toLocaleString('en-IN')} bank transfer on ${recorded.date}${recorded.counterparty ? ` to ${recorded.counterparty}` : ''}`,
            duplicate: { transfer_id: recorded.id, date: recorded.date, amount: Number(recorded.amount), counterparty: recorded.counterparty },
          },
          { status: 409 }
        );
      }
    }

    const created = await service.create({
      account_id,
      investment_date,
      amount: Number(amount),
      kind,
      note,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: parseApiError(error, 'Failed to create investment') },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioInvestmentService(supabase);
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Investment ID is required' }, { status: 400 });
    }

    await service.delete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: parseApiError(error, 'Failed to delete investment') },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioInvestmentService(supabase);
    const body = await request.json();
    const { id, account_id, investment_date, amount, kind, note } = body;

    if (!id) {
      return NextResponse.json({ error: 'Investment ID is required' }, { status: 400 });
    }

    const hasAmount = amount !== undefined && amount !== null;
    if (hasAmount && (!Number.isFinite(Number(amount)) || Number(amount) === 0)) {
      return NextResponse.json({ error: 'amount must be a non-zero number' }, { status: 400 });
    }

    const updated = await service.update({
      id,
      account_id,
      investment_date,
      amount: hasAmount ? Number(amount) : undefined,
      kind,
      note,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: parseApiError(error, 'Failed to update investment') },
      { status: 500 }
    );
  }
}
