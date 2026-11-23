/**
 * Where the data API (PostgREST) and the login service (GoTrue) live, and the keys to use.
 * Read at runtime, never baked into the build, so one image serves every install.
 *
 * Server side, from the environment that scripts/setup.mjs writes:
 *   PUBLIC_URL               where people open Illam; the gateway also serves the API there
 *   ANON_KEY                 public key for signed-out requests (it is in every page anyway)
 *   SERVICE_ROLE_KEY         server-only key for the signed Gmail routes
 *   ILLAM_API_URL            optional: the API's address when it is not PUBLIC_URL (hosted Supabase)
 *   ILLAM_INTERNAL_API_URL   optional: how the server reaches the API (compose: http://gateway:8000)
 *
 * The browser gets the anon key (and ILLAM_API_URL, if set) from /api/runtime-config, and
 * otherwise uses its own origin.
 */

export interface ServerApiConfig {
  /** The API as the browser sees it. */
  publicApiUrl: string;
  /** The API as this server reaches it. */
  serverApiUrl: string;
  anonKey: string;
  serviceKey: string;
}

export interface BrowserRuntimeConfig {
  apiUrl?: string;
  anonKey: string;
}

declare global {
  interface Window {
    __ILLAM_CONFIG__?: BrowserRuntimeConfig;
  }
}

/** Names from early installs. Still read, with a warning, so an existing .env keeps working. */
const LEGACY: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'PUBLIC_URL (or ILLAM_API_URL for a hosted Supabase)',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ANON_KEY',
  SUPABASE_SERVICE_ROLE_KEY: 'SERVICE_ROLE_KEY',
  SUPABASE_INTERNAL_URL: 'ILLAM_INTERNAL_API_URL',
};

export function serverApiConfig(env: NodeJS.ProcessEnv = process.env): ServerApiConfig {
  const used: string[] = [];
  const pick = (name: string, legacy?: string): string => {
    if (env[name]) return env[name]!;
    if (legacy && env[legacy]) {
      used.push(legacy);
      return env[legacy]!;
    }
    return '';
  };

  const publicApiUrl = pick('ILLAM_API_URL') || pick('PUBLIC_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const config: ServerApiConfig = {
    publicApiUrl,
    serverApiUrl: pick('ILLAM_INTERNAL_API_URL', 'SUPABASE_INTERNAL_URL') || publicApiUrl,
    anonKey: pick('ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceKey: pick('SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
  };

  for (const name of used) console.warn(`[illam] ${name} is deprecated; set ${LEGACY[name]} instead.`);
  return config;
}

/** The browser's view: its own origin unless the API lives elsewhere. */
export function browserApiConfig(runtime: BrowserRuntimeConfig | undefined, origin: string): { apiUrl: string; anonKey: string } {
  if (!runtime?.anonKey) {
    throw new Error('Illam runtime config missing: /api/runtime-config did not load before the app.');
  }
  return { apiUrl: runtime.apiUrl || origin, anonKey: runtime.anonKey };
}

/** The body of /api/runtime-config: public values only. */
export function runtimeConfigScript(config: ServerApiConfig, appOrigin: string): string {
  const runtime: BrowserRuntimeConfig = { anonKey: config.anonKey };
  const differs = config.publicApiUrl && new URL(config.publicApiUrl).origin !== new URL(appOrigin).origin;
  const body = differs ? { apiUrl: config.publicApiUrl, ...runtime } : runtime;
  // JSON is valid JS; escaping "<" keeps any value from closing a <script> tag.
  return `window.__ILLAM_CONFIG__=${JSON.stringify(body).replace(/</g, '\\u003c')};`;
}

/** The session cookie's name. Fixed, because the browser and the server reach the API at different hosts. */
export const SESSION_COOKIE_NAME = 'sb-illam-auth-token';
