// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { PWA_CACHE_NAME } from '../version';

describe('PWA version', () => {
  it('keeps public/sw.js CACHE_NAME in sync with lib/pwa/version.ts', () => {
    const swSource = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
    expect(swSource).toContain(`const CACHE_NAME = '${PWA_CACHE_NAME}';`);
  });
});
