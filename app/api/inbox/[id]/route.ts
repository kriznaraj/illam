import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { InboxService } from '@/lib/services/InboxService';
import type { InboxStatus } from '@/types';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const service = new InboxService(createServerClientFromRequest(request));
    const { status } = (await request.json()) as { status: InboxStatus };

    const item = await service.setStatus(params.id, status);
    return NextResponse.json(item);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update inbox item';
    console.error('Error updating inbox item:', message);
    return NextResponse.json({ error: message }, { status: / must be /.test(message) ? 400 : 500 });
  }
}
