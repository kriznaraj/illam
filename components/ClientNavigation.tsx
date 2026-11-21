'use client';

import dynamic from 'next/dynamic';

// dynamic({ ssr: false }) works here because this is a Client Component.
// It cannot be called directly in the root layout (a Server Component).
// This creates a separate lazy chunk for Navigation, only loaded on the client,
// which eliminates all hydration mismatches caused by pathname-based active states.
const Navigation = dynamic(() => import('./Navigation'), { ssr: false });

export default function ClientNavigation() {
  return <Navigation />;
}
