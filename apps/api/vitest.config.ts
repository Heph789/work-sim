import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const sharedSrc = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@work-sim/shared': `${sharedSrc}/index.ts`,
    },
  },
  test: {
    include: [
      'src/**/*.test.ts',
      '../../packages/shared/src/**/*.test.ts',
    ],
  },
});
