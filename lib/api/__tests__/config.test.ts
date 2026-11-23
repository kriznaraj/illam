import { describe, it, expect, vi, afterEach } from 'vitest';
import { browserApiConfig, serverApiConfig, runtimeConfigScript } from '../config';

const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

describe('serverApiConfig', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the names setup.mjs writes, and the internal address compose sets', () => {
    const c = serverApiConfig(env({
      PUBLIC_URL: 'https://illam.example.com',
      ANON_KEY: 'anon',
      SERVICE_ROLE_KEY: 'service',
      ILLAM_INTERNAL_API_URL: 'http://gateway:8000',
    }));

    expect(c).toEqual({
      publicApiUrl: 'https://illam.example.com',
      serverApiUrl: 'http://gateway:8000',
      anonKey: 'anon',
      serviceKey: 'service',
    });
  });

  it('uses ILLAM_API_URL when the API lives elsewhere (a hosted Supabase project)', () => {
    const c = serverApiConfig(env({ PUBLIC_URL: 'https://illam.example.com', ILLAM_API_URL: 'https://abc.supabase.co', ANON_KEY: 'a' }));

    expect(c.publicApiUrl).toBe('https://abc.supabase.co');
    expect(c.serverApiUrl).toBe('https://abc.supabase.co');
  });

  it('still accepts the old names, with a warning, so an existing .env keeps working', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = serverApiConfig(env({
      NEXT_PUBLIC_SUPABASE_URL: 'https://old.example.com',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'old-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'old-service',
      SUPABASE_INTERNAL_URL: 'http://gateway:8000',
    }));

    expect(c).toEqual({
      publicApiUrl: 'https://old.example.com',
      serverApiUrl: 'http://gateway:8000',
      anonKey: 'old-anon',
      serviceKey: 'old-service',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NEXT_PUBLIC_SUPABASE_URL'));
  });
});

describe('browserApiConfig', () => {
  it('talks to the API on its own origin unless told otherwise', () => {
    expect(browserApiConfig({ anonKey: 'anon' }, 'https://illam.example.com')).toEqual({
      apiUrl: 'https://illam.example.com',
      anonKey: 'anon',
    });
    expect(browserApiConfig({ apiUrl: 'https://abc.supabase.co', anonKey: 'anon' }, 'https://illam.example.com').apiUrl)
      .toBe('https://abc.supabase.co');
  });

  it('fails clearly when the runtime config did not load', () => {
    expect(() => browserApiConfig(undefined, 'https://illam.example.com')).toThrow(/runtime-config/);
  });
});

describe('runtimeConfigScript', () => {
  it('hands the browser only the public values', () => {
    const js = runtimeConfigScript({ publicApiUrl: 'https://illam.example.com', serverApiUrl: 'http://gateway:8000', anonKey: 'anon', serviceKey: 'secret' }, 'https://illam.example.com');

    expect(js).toBe('window.__ILLAM_CONFIG__={"anonKey":"anon"};');
    expect(js).not.toContain('secret');
    expect(js).not.toContain('gateway');
  });

  it('includes the API address only when it differs from the app', () => {
    const js = runtimeConfigScript({ publicApiUrl: 'https://abc.supabase.co', serverApiUrl: 'https://abc.supabase.co', anonKey: 'anon', serviceKey: '' }, 'https://illam.example.com');

    expect(js).toBe('window.__ILLAM_CONFIG__={"apiUrl":"https://abc.supabase.co","anonKey":"anon"};');
  });

  it('cannot be broken out of with a crafted value', () => {
    const js = runtimeConfigScript({ publicApiUrl: 'https://x', serverApiUrl: 'https://x', anonKey: '</script><script>alert(1)', serviceKey: '' }, 'https://x');

    expect(js).not.toContain('</script>');
  });
});
