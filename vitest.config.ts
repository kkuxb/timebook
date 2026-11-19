import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@timebook/core': path.resolve(rootDir, 'packages/core/src/index.ts'),
      '@timebook/notion-import': path.resolve(rootDir, 'tools/notion-import/src/index.ts')
    }
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'tools/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts'
    ],
    environment: 'node',
    testTimeout: 15000
  }
});
