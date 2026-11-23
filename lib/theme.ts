/**
 * Light, dark, or the system's choice. Kept per device in localStorage (it is a display
 * preference, not account data) and applied as <html data-theme>, which the colour tokens in
 * tailwind.config.js honour over the system setting.
 */
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'illam-theme';

export function readTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked (private mode): the choice still applies until the page reloads.
  }
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

/** Inlined in <head> (app/layout.tsx) so a chosen theme is set before the first paint. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
