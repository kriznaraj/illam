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
    background_color: '#0d0d1a',
    theme_color: '#2442C9',
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
        name: 'Add Expense',
        short_name: 'Add',
        description: 'Quick add new expense',
        url: '/expenses',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Selavu Report',
        short_name: 'Report',
        description: 'View spending reports',
        url: '/expenses/report',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Selvam',
        short_name: 'Selvam',
        description: 'View portfolio dashboard',
        url: '/portfolio',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
