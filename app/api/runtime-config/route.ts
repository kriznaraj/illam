import { NextResponse } from 'next/server';
import { runtimeConfigScript, serverApiConfig } from '@/lib/api/config';

// Read on every request, never at build time: this is what lets one image serve any install.
export const dynamic = 'force-dynamic';

/** The public settings the browser needs, as a script loaded before the app (app/layout.tsx). */
export function GET(request: Request) {
  const appOrigin = process.env.PUBLIC_URL || new URL(request.url).origin;
  return new NextResponse(runtimeConfigScript(serverApiConfig(), appOrigin), {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
