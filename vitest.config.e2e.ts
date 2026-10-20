import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    // Same as vitest.config.ts: inline zod so `import { z } from 'zod'` keeps
    // its named export under Bun (the externalized CJS interop drops it).
    server: { deps: { inline: ['zod'] } },
  },
});
