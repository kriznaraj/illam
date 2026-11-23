import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { logApiError, cachedJson } from '@/lib/utils';
import { EventService } from '@/lib/services/EventService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const eventService = new EventService(supabase);
    
    const events = await eventService.getAllEventsForApi();
    return cachedJson(events, 'static');
  } catch (error) {
    logApiError('Error in events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const eventService = new EventService(supabase);
    
    const body = await request.json();
    const { name, description, start_date, end_date, budget, color, is_active } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Event name is required' },
        { status: 400 }
      );
    }

    try {
      const event = await eventService.createEvent({
        name,
        description: description || null,
        start_date: start_date || null,
        end_date: end_date || null,
        budget: budget || null,
        color: color || '#3b82f6',
        is_active: is_active !== undefined ? is_active : true,
      });
      return NextResponse.json(event, { status: 201 });
    } catch (error) {
      // Preserve route robustness: map duplicate-name errors to 409
      if (error instanceof Error && /already exists/i.test(error.message)) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    logApiError('Error in events:', error);
    return NextResponse.json(
      { error: 'Failed to create event' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const eventService = new EventService(supabase);
    
    const body = await request.json();
    const { id, name, description, start_date, end_date, budget, color, is_active } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Event ID is required' },
        { status: 400 }
      );
    }

    const event = await eventService.updateEvent(id, {
      name,
      description,
      start_date,
      end_date,
      budget,
      color,
      is_active,
    });
    return NextResponse.json(event);
  } catch (error) {
    logApiError('Error in events:', error);
    return NextResponse.json(
      { error: 'Failed to update event' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const eventService = new EventService(supabase);
    
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Event ID is required' },
        { status: 400 }
      );
    }

    await eventService.deleteEvent(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError('Error in events:', error);
    return NextResponse.json(
      { error: 'Failed to delete event' },
      { status: 500 }
    );
  }
}
