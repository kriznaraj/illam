import { NextResponse, type NextRequest } from 'next/server';
import type { InboxOwner } from '@/types';
import { parseOwner, secretForOwner, verifySignature } from './signature';

/**
 * Authentication for the session-less routes the Gmail Apps Script calls
 * (middleware.ts SESSIONLESS_API_PATHS). Returns the owner, or the response to
 * send back.
 */
export function authenticateScriptRequest(request: NextRequest, body: string): { owner: InboxOwner } | NextResponse {
  const owner = parseOwner(request.headers.get('x-illam-owner'));
  if (!owner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secret = secretForOwner(owner);
  if (!secret) {
    return NextResponse.json({ error: 'Inbox ingestion is not configured for this owner' }, { status: 503 });
  }

  const check = verifySignature({
    secret,
    timestamp: request.headers.get('x-illam-timestamp'),
    signature: request.headers.get('x-illam-signature'),
    body,
  });
  if (!check.ok) {
    return NextResponse.json({ error: 'Unauthorized', reason: check.reason }, { status: 401 });
  }
  return { owner };
}
