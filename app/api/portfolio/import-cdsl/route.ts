import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { PortfolioCdslImportService } from '@/lib/services/PortfolioCdslImportService';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const body = await request.json();
    const service = new PortfolioCdslImportService(supabase);
    const result = await service.importCdsl(body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 },
    );
  }
}
