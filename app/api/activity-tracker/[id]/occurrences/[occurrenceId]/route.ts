import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { ActivityTrackerService } from '@/lib/services/ActivityTrackerService';
import { mapOccurrenceApiError } from '@/lib/activity-tracker/apiErrors';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; occurrenceId: string } }
) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new ActivityTrackerService(supabase);
    const body = await request.json();

    const occurrence = await service.updateOccurrence(params.id, params.occurrenceId, {
      occurred_at: body.date,
      comment: body.comment,
    });

    return NextResponse.json(occurrence);
  } catch (error) {
    console.error('Error updating occurrence:', error);
    const { message, status } = mapOccurrenceApiError(error, 'Failed to update occurrence');
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; occurrenceId: string } }
) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new ActivityTrackerService(supabase);

    await service.deleteOccurrence(params.id, params.occurrenceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting occurrence:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete occurrence' },
      { status: 500 }
    );
  }
}
