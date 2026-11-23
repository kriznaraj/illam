import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { logApiError } from '@/lib/utils';
import { UserService } from '@/lib/services/UserService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const userService = new UserService(supabase);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    const users = id
      ? await userService.getActiveUserById(id).then(u => (u ? [u] : []))
      : await userService.getActiveUsersSorted();

    return NextResponse.json(users ?? []);
  } catch (error) {
    logApiError('Error in users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
