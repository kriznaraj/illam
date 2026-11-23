import pkg from '@/package.json';

/**
 * Who makes Illam and where its source lives: the About page, the login footer and the
 * README credit all read this. Self-hosters running their own copy leave it as it is; it
 * describes the software, not whoever runs the server.
 */
export const ABOUT = {
  version: pkg.version,
  licence: { name: 'GNU AGPL v3', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
  repo: 'https://github.com/kriznaraj/illam',
  maker: { name: 'Aatra', url: 'https://aatra.ai' },
  maintainers: [{ name: 'Krishnaraj Venkatesan', role: 'Founder, Aatra · Maintainer', github: 'kriznaraj' }],
  builtWith: [
    { name: 'Next.js', url: 'https://nextjs.org' },
    { name: 'PostgreSQL', url: 'https://www.postgresql.org' },
    { name: 'PostgREST', url: 'https://postgrest.org' },
    { name: 'Supabase Auth', url: 'https://github.com/supabase/auth' },
    { name: 'Caddy', url: 'https://caddyserver.com' },
    { name: 'Lucide icons', url: 'https://lucide.dev' },
  ],
} as const;

export const repoLink = (path = '') => `${ABOUT.repo}${path}`;
