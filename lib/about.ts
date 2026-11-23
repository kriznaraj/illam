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
} as const;

export const repoLink = (path = '') => `${ABOUT.repo}${path}`;
