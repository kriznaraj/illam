import { createBrowserClient } from '@supabase/ssr';
import { SESSION_COOKIE_NAME, SUPABASE_ANON_KEY as supabaseAnonKey, SUPABASE_PUBLIC_URL as supabaseUrl } from './supabase-config';

const cookieOptions = { name: SESSION_COOKIE_NAME };

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

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
      browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, { cookieOptions });
    }
    return browserClient;
  }

  // SSR path: return a fresh instance (not cached, safe per-request)
  return createBrowserClient(supabaseUrl, supabaseAnonKey, { cookieOptions });
}
