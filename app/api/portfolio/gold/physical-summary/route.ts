import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { GoldRegisterService } from '@/lib/services/GoldRegisterService';

export const dynamic = 'force-dynamic';

/** Total gold weight (grams) of physical items only. */
export async function GET(req: NextRequest) {
  try {
    const service = new GoldRegisterService(createServerClientFromRequest(req));
    return NextResponse.json(await service.physicalSummary());
  } catch (error) {
    console.error('Error fetching physical gold summary:', error);
    return NextResponse.json({ error: 'Failed to fetch physical gold summary' }, { status: 500 });
  }
}
