'use client';

import { useEffect } from 'react';
import { applyTheme, readTheme } from '@/lib/theme';

/**
 * Re-applies the chosen theme once React has loaded. The inline script in app/layout.tsx sets
 * it before the first paint, but if React ever has to re-render the page from scratch it
 * rebuilds <html> without that attribute; this puts it back.
 */
export function ThemeSync() {
  useEffect(() => applyTheme(readTheme()), []);
  return null;
}
