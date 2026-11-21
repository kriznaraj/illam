import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { cachedJson } from '@/lib/utils';
import { TagService } from '@/lib/services/TagService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const tagService = new TagService(supabase);
    
    const searchParams = request.nextUrl.searchParams;
    // Family-wide semantics: everything is shared/visible to everyone.
    // Keep reading query params for backward compatibility, but do not use them.
    // (Some older UI paths may still send `userId` or `all`.)
    void searchParams.get('userId');
    void searchParams.get('all');

    const tags = await tagService.getAllTags();
    return cachedJson(tags, 'realtime');
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tags' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const tagService = new TagService(supabase);
    
    const body = await request.json();
    const { name, color } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Tag name is required' },
        { status: 400 }
      );
    }

    // Preserve old route behavior:
    // - If a tag already exists, return 200 with the existing tag
    // - Otherwise return 201 with the newly created tag
    const existing = await tagService.getTagByName(name);
    if (existing) {
      return NextResponse.json(existing, { status: 200 });
    }

    const created = await tagService.createTag({ name, color });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to create tag' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const tagService = new TagService(supabase);
    
    const body = await request.json();
    const { id, name, color } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Tag ID is required' },
        { status: 400 }
      );
    }

    const updated = await tagService.updateTag(id, { name, color });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to update tag' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const tagService = new TagService(supabase);
    
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Tag ID is required' },
        { status: 400 }
      );
    }

    await tagService.deleteTag(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete tag' },
      { status: 500 }
    );
  }
}
