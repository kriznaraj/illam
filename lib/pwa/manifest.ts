import type { MetadataRoute } from 'next';

/** Shared web app manifest — served by app/manifest.ts at /manifest.webmanifest */
export function getWebManifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Illam',
    short_name: 'Illam',
    description: 'Household finance for Indian families: spending, bank mail, statements and net worth.',
    // /login returns 200 without auth; logged-in users are redirected to /home by middleware.
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f7f5',
    theme_color: '#23687a',
    orientation: 'portrait-primary',
    categories: ['finance', 'productivity'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Expenses',
        short_name: 'Expenses',
        description: 'This month\'s spending',
        url: '/expenses',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Spending report',
        short_name: 'Report',
        description: 'Spending by category and month',
        url: '/expenses/report',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Net worth',
        short_name: 'Net worth',
        description: 'Accounts, investments and net worth',
        url: '/portfolio',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
