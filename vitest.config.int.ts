import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.int-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    // Same as vitest.config.ts: inline zod so `import { z } from 'zod'` keeps
    // its named export under Bun (the externalized CJS interop drops it).
    server: { deps: { inline: ['zod'] } },
  },
});
