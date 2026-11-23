import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { GoldRateService } from '@/lib/services/GoldRateService';

export const dynamic = 'force-dynamic';

// GET  → { rate_22k: number, rate_24k: number }
// PUT  { rate_22k?, rate_24k? } → updates whichever is provided
export async function GET(req: NextRequest) {
  const supabase = createServerClientFromRequest(req);
  const service = new GoldRateService(supabase);
  return NextResponse.json(await service.getRates());
}

export async function PUT(req: NextRequest) {
  const supabase = createServerClientFromRequest(req);
  const { rate_22k, rate_24k } = await req.json();
  const service = new GoldRateService(supabase);
  try {
    return NextResponse.json(await service.setRates({ rate_22k, rate_24k }));
  } catch (e) {
    if (e instanceof Error && e.message === 'Provide rate_22k and/or rate_24k') {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
