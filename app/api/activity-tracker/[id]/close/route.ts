import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { ActivityTrackerService } from '@/lib/services/ActivityTrackerService';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new ActivityTrackerService(supabase);

    const body = await request.json().catch(() => ({}));
    const reopen = body.reopen === true;

    const event = reopen
      ? await service.reopen(params.id)
      : await service.close(params.id);

    return NextResponse.json(event);
  } catch (error) {
    console.error('Error updating event status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update status' },
      { status: 500 }
    );
  }
}
