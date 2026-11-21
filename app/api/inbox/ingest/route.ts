import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { InboxService } from '@/lib/services/InboxService';
import { attachmentSenders, buildGmailQuery } from '@/lib/inbox/sources';
import { authenticateScriptRequest } from '@/lib/inbox/requestAuth';
import { configuredPasswordSources } from '@/lib/statements/passwords';
import { statementCaptureEnabled } from '@/lib/services/StatementCaptureService';
import type { InboxIngestMessage } from '@/types';

/**
 * Called by the Gmail Apps Script in each account, never by the browser.
 *
 * This is the only /api route without a session (middleware.ts exempts this
 * exact path), so it authenticates itself: an HMAC signature with a per-owner
 * secret over `${timestamp}.${body}`. See lib/inbox/signature.ts.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Statement emails carry their PDFs, which are unlocked and read in the request.
export const maxDuration = 60;

// Vercel rejects request bodies over 4.5 MB; the script caps PDFs at 2.5 MB raw (~3.4 MB as base64).
const MAX_BODY_BYTES = 4_000_000;
const BACKFILL_DAYS = 90;
// The first live run pushed 40 messages in ~63 s; Apps Script allows 6 minutes per run.
const MAX_PER_RUN = 150;

const authenticate = authenticateScriptRequest;

/** Configuration for the script, so the sender list lives in code rather than in two Gmail accounts. */
export async function GET(request: NextRequest) {
  const auth = authenticate(request, '');
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    owner: auth.owner,
    // Which commit is serving, so a run can be matched to the deploy that handled it.
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    query: buildGmailQuery(),
    attachmentSenders: attachmentSenders(),
    // Diagnostics for statement PDFs: whether capture is on and which sources have
    // passwords set (names only). Env changes need a redeploy to show up here.
    statements: {
      captureEnabled: statementCaptureEnabled(),
      passwords: configuredPasswordSources(auth.owner),
    },
    backfillDays: BACKFILL_DAYS,
    maxPerRun: MAX_PER_RUN,
  });
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const body = await request.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const auth = authenticate(request, body);
  if (auth instanceof NextResponse) return auth;

  let message: InboxIngestMessage;
  try {
    message = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  try {
    const service = new InboxService(createServiceClient());
    const result = await service.ingest(auth.owner, message);

    if (result.status === 'ignored') {
      return NextResponse.json(result);
    }
    return NextResponse.json(
      {
        status: result.status,
        id: result.item.id,
        kind: result.item.kind,
        needsAttention: result.item.needs_attention,
        ...(result.statements ? { statements: result.statements } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Failed to ingest message';
    const isValidation = / is required$| must be /.test(messageText);
    console.error('Error ingesting inbox message:', messageText);
    return NextResponse.json({ error: messageText }, { status: isValidation ? 400 : 500 });
  }
}
