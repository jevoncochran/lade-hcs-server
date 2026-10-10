import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig } from 'vitest/config';

// e2e tests run against the separate lade_hcs_test database, never the dev
// database. Prepare it with `npm run test:db:prepare`.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.e2e-spec.ts'],
    env: parse(readFileSync('.env.test')),
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
