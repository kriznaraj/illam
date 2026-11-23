import { createClient } from '@supabase/supabase-js';
import { createServerClient as createSsrClient, type CookieOptions } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { Agent, fetch as undiciFetch } from 'undici';
import { SESSION_COOKIE_NAME, serverApiConfig } from './config';

const cookieOptions = { name: SESSION_COOKIE_NAME };

// Next.js App Router caches fetch() calls by default — including the ones made
// internally by the Supabase SDK. This caused stale data to be returned after a
// statement insert, making it look like the save failed. We override the fetch
// used by every server-side client to always opt out of that cache.
//
// Additionally, Node's default Undici connect timeout (10s) can be too aggressive
// for cold starts / transient network slowness, causing noisy "fetch failed"
// errors. We use an Undici Agent with a longer connect timeout and apply an
// overall request timeout via AbortController. We do NOT retry here because
// Supabase requests include writes (insert/update) which are not safely retryable.
const supabaseDispatcher = new Agent({
  connectTimeout: 30_000,
});

function withTimeout(init: RequestInit | undefined, timeoutMs: number): RequestInit {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);

  const upstreamSignal = init?.signal;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort(upstreamSignal.reason);
    } else {
      upstreamSignal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeoutId);
          controller.abort(upstreamSignal.reason);
        },
        { once: true }
      );
    }
  }

  return {
    ...init,
    signal: controller.signal,
  };
}

const noStoreFetch: typeof fetch = (input, init) => {
  const finalInit = withTimeout({ ...init, cache: 'no-store' }, 45_000) as RequestInit & {
    // Undici-specific extension used by undici's fetch implementation.
    dispatcher?: Agent;
  };

  // Bypass Next.js request caching by using undici's fetch directly.
  // This still returns a standard WHATWG Response compatible with Supabase.
  // Both args are cast: undici's RequestInit and the DOM lib's disagree on
  // `body` (undici accepts ReadableStream, the DOM type does not), so the
  // structurally-identical object won't assign across the two declarations.
  return undiciFetch(input as any, {
    ...finalInit,
    dispatcher: supabaseDispatcher,
  } as any) as any;
};

/**
 * Server client for API routes, acting as the signed-in user.
 *
 * Reads the session from the request's cookies, so the database sees the `authenticated`
 * role. The anon role has no grants at all (db/migrations), so a client without a session
 * can read nothing. Middleware refreshes the session and writes cookies on responses, so
 * this client never sets them.
 */
export function createServerClientFromRequest(request: NextRequest) {
  const { serverApiUrl, anonKey } = serverApiConfig();
  return createSsrClient(serverApiUrl, anonKey, {
    cookieOptions,
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(_name: string, _value: string, _options: CookieOptions) {},
      remove(_name: string, _options: CookieOptions) {},
    },
    global: { fetch: noStoreFetch },
  });
}

/**
 * Service-role client, for the session-less routes that verify their own HMAC signature
 * (/api/inbox/ingest and /api/inbox/process — see middleware.ts). Never use it in a route a
 * browser session reaches, and never expose SERVICE_ROLE_KEY to the client.
 */
export function createServiceClient() {
  const { serverApiUrl, serviceKey } = serverApiConfig();
  if (!serviceKey) throw new Error('SERVICE_ROLE_KEY is not set');
  return createClient(serverApiUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  });
}
