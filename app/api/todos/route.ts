import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { TodoService } from '@/lib/services/TodoService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const todoService = new TodoService(supabase);

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');

    const todos = await todoService.list({ status: status || undefined, priority: priority || undefined });
    return NextResponse.json(todos);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to fetch todos' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const todoService = new TodoService(supabase);

    const body = await request.json();
    const { title, description, status, priority, due_date, user_id } = body;

    if (!title || title.trim() === '') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const todo = await todoService.create({
      user_id: typeof user_id === 'string' && user_id.trim() ? user_id : null,
      title,
      description,
      status,
      priority,
      due_date,
    });
    return NextResponse.json(todo, { status: 201 });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to create todo' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const todoService = new TodoService(supabase);

    const body = await request.json();
    const { id, title, description, status, priority, due_date, user_id } = body;

    if (!id) {
      return NextResponse.json({ error: 'Todo ID is required' }, { status: 400 });
    }

    const todo = await todoService.update(id, {
      title,
      description,
      status,
      priority,
      due_date,
      user_id: user_id === '' ? null : user_id,
    });
    return NextResponse.json(todo);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to update todo' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const todoService = new TodoService(supabase);

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Todo ID is required' }, { status: 400 });
    }

    await todoService.delete(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to delete todo' }, { status: 500 });
  }
}
