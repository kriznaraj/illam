import { createBrowserClient } from '@supabase/ssr';
import { SESSION_COOKIE_NAME, browserApiConfig, serverApiConfig } from './config';

const cookieOptions = { name: SESSION_COOKIE_NAME };

// Single browser client singleton shared across auth and data operations.
// Uses @supabase/ssr's createBrowserClient so the session is read from cookies
// (set by the middleware/SSR auth flow) — eliminating the localStorage async-init
// race condition that caused the first expense-add attempt to fail.
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  // createBrowserClient from @supabase/ssr handles both client and SSR contexts.
  // The singleton is only kept client-side (window check) to avoid sharing state
  // across server requests, but we never throw during SSR.
  if (typeof window !== 'undefined') {
    if (!browserClient) {
      // Values from /api/runtime-config, loaded before the app (app/layout.tsx).
      const { apiUrl, anonKey } = browserApiConfig(window.__ILLAM_CONFIG__, window.location.origin);
      browserClient = createBrowserClient(apiUrl, anonKey, { cookieOptions });
    }
    return browserClient;
  }

  // SSR path: return a fresh instance (not cached, safe per-request). At build time, when pages
  // are prerendered, there is no config yet; components only fetch in effects, which never run
  // there, so a placeholder client is never used to make a request.
  const { serverApiUrl, anonKey } = serverApiConfig();
  return createBrowserClient(serverApiUrl || 'http://prerender.invalid', anonKey || 'prerender', { cookieOptions });
}
