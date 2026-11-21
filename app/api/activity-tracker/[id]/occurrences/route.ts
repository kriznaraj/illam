import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { ActivityTrackerService } from '@/lib/services/ActivityTrackerService';
import { mapOccurrenceApiError } from '@/lib/activity-tracker/apiErrors';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new ActivityTrackerService(supabase);
    const occurrences = await service.getOccurrences(params.id);
    return NextResponse.json(occurrences);
  } catch (error) {
    console.error('Error fetching occurrences:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch occurrences' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new ActivityTrackerService(supabase);

    const body = await request.json().catch(() => ({}));
    const occurrence = await service.logOccurrence(
      params.id,
      body.date,
      body.comment
    );

    return NextResponse.json(occurrence, { status: 201 });
  } catch (error) {
    console.error('Error logging occurrence:', error);
    const { message, status } = mapOccurrenceApiError(error, 'Failed to log occurrence');
    return NextResponse.json({ error: message }, { status });
  }
}
