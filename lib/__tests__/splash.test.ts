import { describe, expect, it, beforeEach } from 'vitest';
import { SPLASH_ATTR, SPLASH_INIT_SCRIPT } from '../splash';

describe('SPLASH_INIT_SCRIPT', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.documentElement.removeAttribute(SPLASH_ATTR);
  });

  it('is a plain string, so the server layout can inline it', () => {
    expect(typeof SPLASH_INIT_SCRIPT).toBe('string');
  });

  it('shows the splash on the first load of a session only', () => {
    new Function(SPLASH_INIT_SCRIPT)();
    expect(document.documentElement.hasAttribute(SPLASH_ATTR)).toBe(true);
    document.documentElement.removeAttribute(SPLASH_ATTR);
    new Function(SPLASH_INIT_SCRIPT)();
    expect(document.documentElement.hasAttribute(SPLASH_ATTR)).toBe(false);
  });
});
