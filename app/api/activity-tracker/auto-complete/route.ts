import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { ActivityTrackerService } from '@/lib/services/ActivityTrackerService';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new ActivityTrackerService(supabase);
    await service.advanceAnnualEvents();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in auto-complete endpoint:', error);
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
