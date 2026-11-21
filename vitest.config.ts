import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

// The tests run against the example household (Alice and Bob) — see lib/household.ts.
const household = JSON.stringify(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'household.example.json'), 'utf8')));

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Tests never reach a real AI provider, whatever the environment holds: `pnpm run build`
    // runs them first, and a build environment may have ANTHROPIC_API_KEY set.
    env: { ANTHROPIC_API_KEY: '', ILLAM_HOUSEHOLD: household },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
