import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The auth client is mocked: what matters is which answer the middleware trusts.
const auth = { getUser: vi.fn(), getSession: vi.fn() };
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth }) }));

const { middleware } = await import('../../middleware');
const req = (path: string) => new NextRequest(new URL(path, 'https://illam.example.com'));

describe('middleware', () => {
  beforeEach(() => {
    auth.getUser.mockReset();
    auth.getSession.mockReset();
    // A session read straight from the cookie: present, but never checked with the server.
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'forged' } }, error: null });
  });

  it('refuses an API call when the server does not vouch for the user, whatever the cookie says', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });

    const res = await middleware(req('/api/expenses'));

    expect(res.status).toBe(401);
  });

  it('sends a page request to login when the user is not verified', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });

    const res = await middleware(req('/expenses'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Fexpenses');
  });

  it('lets a verified user through', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });

    const res = await middleware(req('/api/expenses'));

    expect(res.status).toBe(200);
  });

  it('serves the public runtime config without a session (the login page needs it)', async () => {
    const res = await middleware(req('/api/runtime-config'));

    expect(res.status).toBe(200);
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it('leaves the signed Gmail routes to check their own signatures', async () => {
    const res = await middleware(req('/api/inbox/ingest'));

    expect(res.status).toBe(200);
    expect(auth.getUser).not.toHaveBeenCalled();
  });
});
