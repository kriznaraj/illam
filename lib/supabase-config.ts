/**
 * Where the Supabase-compatible API lives (PostgREST + GoTrue behind one gateway), and the
 * cookie the session is kept in.
 *
 * The browser always uses NEXT_PUBLIC_SUPABASE_URL. Server code may reach the same API at a
 * different address — inside docker compose the app talks to `http://gateway:8000` while the
 * browser uses `http://localhost:8000` — so the cookie name is fixed rather than derived from
 * the URL's host, which would otherwise differ between the two.
 */
export const SUPABASE_PUBLIC_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SUPABASE_SERVER_URL = process.env.SUPABASE_INTERNAL_URL || SUPABASE_PUBLIC_URL;
export const SESSION_COOKIE_NAME = 'sb-illam-auth-token';
