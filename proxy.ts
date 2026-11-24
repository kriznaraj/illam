import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, serverApiConfig } from '@/lib/api/config';

// The only /api routes reachable without a session. Each must authenticate the
// request itself; keep this an exact-path list, never a prefix.
//   /api/inbox/ingest  — called by the Gmail Apps Script, which has no session.
//   /api/inbox/process — same caller; runs automation after each sync.
//   Both verify a per-owner HMAC signature (lib/inbox/requestAuth.ts).
//   /api/runtime-config — the public settings the browser needs before anyone signs in
//   (the login page uses them). Public by nature: the anon key, and the API's address.
const SESSIONLESS_API_PATHS = new Set(['/api/inbox/ingest', '/api/inbox/process', '/api/runtime-config']);

export async function proxy(request: NextRequest) {
  if (SESSIONLESS_API_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const { serverApiUrl, anonKey } = serverApiConfig();
  const supabase = createServerClient(
    serverApiUrl,
    anonKey,
    {
      cookieOptions: { name: SESSION_COOKIE_NAME },
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  // getUser() asks the auth server to verify the token (refreshing an expired one first).
  // getSession() would only read the cookie, which anyone can forge; the data would still be
  // safe behind PostgREST's own check, but the pages and routes here would open.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = Boolean(user);

  // Protect API routes. Every /api/* route requires a session, apart from the
  // exact paths in SESSIONLESS_API_PATHS above, which verify their own
  // signatures. Keep that list exact: a prefix match would make any future
  // route under it silently public.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    if (!signedIn) {
      return NextResponse.json(
        { error: 'Unauthorized - Please login' },
        { status: 401 }
      );
    }
  }

  const pathname = request.nextUrl.pathname;

  // Redirect unauthenticated users to login (except login page itself)
  if (!signedIn && !pathname.startsWith('/login')) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated: redirect root → /home and /login → /home
  if (signedIn && (pathname === '/' || pathname === '/login')) {
    return NextResponse.redirect(new URL('/home', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - sw.js (service worker)
     * - manifest.json (PWA manifest)
     * - public folder assets (images, icons)
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|manifest.webmanifest|offline.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
