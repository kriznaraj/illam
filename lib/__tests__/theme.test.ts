import { describe, it, expect, beforeEach } from 'vitest';
import { THEME_INIT_SCRIPT, applyTheme, readTheme } from '../theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('follows the system until a theme is chosen', () => {
    expect(readTheme()).toBe('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('remembers a chosen theme and marks the page with it', () => {
    applyTheme('dark');

    expect(readTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('goes back to the system setting', () => {
    applyTheme('light');
    applyTheme('system');

    expect(readTheme()).toBe('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem('illam-theme', 'purple');

    expect(readTheme()).toBe('system');
  });

  it('applies the stored theme before the app loads (the inline script)', () => {
    localStorage.setItem('illam-theme', 'light');
    new Function(THEME_INIT_SCRIPT)();

    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
