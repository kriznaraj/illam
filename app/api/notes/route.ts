import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { NoteService } from '@/lib/services/NoteService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const noteService = new NoteService(supabase);
    

    const searchParams = request.nextUrl.searchParams;
    const archived = searchParams.get('archived') === 'true';
    const search = searchParams.get('search');
    const tag = searchParams.get('tag');

    const notes = await noteService.list({ archived, search: search || undefined, tag: tag || undefined });
    return NextResponse.json(notes);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const noteService = new NoteService(supabase);
    

    const body = await request.json();
    const { title, content, tags, is_pinned } = body;

    if (!title || title.trim() === '') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const note = await noteService.create({ title, content, tags, is_pinned });
    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createClient();
    const noteService = new NoteService(supabase);
    

    const body = await request.json();
    const { id, title, content, tags, is_pinned, is_archived } = body;

    if (!id) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 });
    }

    const note = await noteService.update(id, { title, content, tags, is_pinned, is_archived });
    return NextResponse.json(note);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createClient();
    const noteService = new NoteService(supabase);
    

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 });
    }

    await noteService.delete(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
  }
}
