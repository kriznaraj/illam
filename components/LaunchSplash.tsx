'use client';

import { useEffect } from 'react';
import IllamLogo from '@/components/IllamLogo';
import { FromAatra } from '@/components/FromAatra';
import { SPLASH_ATTR } from '@/lib/splash';

/**
 * The launch screen: the Illam mark in the middle and "from Aatra" at the bottom.
 * It is in the server HTML, so it appears before the app loads, and fades out once React is
 * ready. A CSS timeout (globals.css) hides it anyway if scripts never run.
 */
export function LaunchSplash() {
  useEffect(() => {
    const t = setTimeout(() => document.documentElement.removeAttribute(SPLASH_ATTR), 700);
    return () => clearTimeout(t);
  }, []);

  return (
    <div id="launch-splash" aria-hidden className="fixed inset-0 z-[100] flex-col items-center justify-between bg-gray-50 py-12">
      <span />
      <IllamLogo size={72} />
      <FromAatra link={false} />
    </div>
  );
}
