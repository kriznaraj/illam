import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { cachedJson } from '@/lib/utils';
import { CategoryService } from '@/lib/services/CategoryService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/categories
 * Fetch all categories sorted by sort_order
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const categoryService = new CategoryService(supabase);

    const categories = await categoryService.getAllCategories();

    return cachedJson(categories, 'realtime');
  } catch (error) {
    console.error('Error in GET /api/categories:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/categories
 * Create a new category
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const categoryService = new CategoryService(supabase);

    const body = await request.json();
    const { name, group_name, icon, budget, color, sort_order } = body;

    // Service handles validation and duplicate checking
    const category = await categoryService.createCategory({
      name,
      group_name,
      icon,
      budget,
      color,
      sort_order: sort_order || 0,
    });

    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/categories:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create category' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/categories
 * Update an existing category
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const categoryService = new CategoryService(supabase);

    const body = await request.json();
    const { id, name, group_name, icon, budget, color, sort_order } = body;

    if (!id) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }

    // Service handles validation and duplicate checking
    const category = await categoryService.updateCategory(id, {
      name,
      group_name,
      icon,
      budget,
      color,
      sort_order,
    });

    return NextResponse.json(category);
  } catch (error) {
    console.error('Error in PUT /api/categories:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update category' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/categories
 * Delete a category
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const categoryService = new CategoryService(supabase);

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }

    await categoryService.deleteCategory(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/categories:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete category' },
      { status: 500 }
    );
  }
}
