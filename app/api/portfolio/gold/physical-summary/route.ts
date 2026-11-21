import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { GoldRegisterService } from '@/lib/services/GoldRegisterService';

export const dynamic = 'force-dynamic';

// GET /api/portfolio/gold/physical-summary
// Returns total gold weight (grams) from physical items only
export async function GET(req: NextRequest) {
  const supabase = createServerClientFromRequest(req);
  const service = new GoldRegisterService(supabase);
  return NextResponse.json(await service.physicalSummary());
}
