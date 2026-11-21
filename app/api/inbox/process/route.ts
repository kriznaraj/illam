import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { InboxAutomationService } from '@/lib/services/InboxAutomationService';
import { authenticateScriptRequest } from '@/lib/inbox/requestAuth';

/**
 * Runs Madal automation over every unprocessed transaction alert: link to an
 * existing expense, auto-add after the grace period, log transfers, mark card
 * bills paid. Called by the Gmail Apps Script at the end of each run, so it is
 * session-less (middleware.ts SESSIONLESS_API_PATHS) and signature-checked.
 *
 * Body: `{}` or `{"dryRun": true}` to see what would happen without writing.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Stop starting new alerts well inside maxDuration; the script calls again for the rest.
const TIME_BUDGET_MS = 40_000;

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (body.length > 10_000) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const auth = authenticateScriptRequest(request, body);
  if (auth instanceof NextResponse) return auth;

  let dryRun = false;
  try {
    dryRun = body ? JSON.parse(body)?.dryRun === true : false;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  try {
    const service = new InboxAutomationService(createServiceClient());
    const result = await service.process({ dryRun, timeBudgetMs: TIME_BUDGET_MS });
    return NextResponse.json({
      dryRun: result.dryRun,
      counts: result.counts,
      remaining: result.remaining,
      resolved: result.resolved,
      // A dry run is for reading; a real run only needs the tally.
      actions: dryRun ? result.actions : result.actions.filter((a) => a.outcome === 'error'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process inbox';
    console.error('Error processing inbox:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
