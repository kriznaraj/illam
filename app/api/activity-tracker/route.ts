import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { ActivityTrackerService } from '@/lib/services/ActivityTrackerService';
import type { ActivityTrackerFormData, ActivityTrackerEventType, ActivityTrackerStatus } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new ActivityTrackerService(supabase);

    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get('type') as ActivityTrackerEventType | null;
    const status = searchParams.get('status') as ActivityTrackerStatus | null;
    const history = searchParams.get('history') === 'true';

    if (!history) {
      await service.advanceAnnualEvents();
    }

    const events = await service.getFiltered({
      event_type: eventType || undefined,
      status: status || undefined,
      history,
    });

    return NextResponse.json(events);
  } catch (error) {
    console.error('Error fetching activity tracker events:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new ActivityTrackerService(supabase);

    const formData: ActivityTrackerFormData = await request.json();

    if (!formData.title || !formData.event_type || !formData.event_date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const event = await service.create(formData);
    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    console.error('Error creating activity tracker event:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create event' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new ActivityTrackerService(supabase);

    const { id, ...formData } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
    }

    const event = await service.update(id, formData);
    return NextResponse.json(event);
  } catch (error) {
    console.error('Error updating activity tracker event:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update event' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new ActivityTrackerService(supabase);

    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
    }

    await service.delete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting activity tracker event:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete event' },
      { status: 500 }
    );
  }
}
