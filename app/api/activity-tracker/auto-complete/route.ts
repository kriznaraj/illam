import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { ActivityTrackerService } from '@/lib/services/ActivityTrackerService';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const supabase = createClient();
    const service = new ActivityTrackerService(supabase);
    await service.advanceAnnualEvents();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in auto-complete endpoint:', error);
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
