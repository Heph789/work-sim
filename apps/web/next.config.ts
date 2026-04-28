// Next.js config. Kept intentionally minimal for the prototype.
//
// Notes for future-us:
// - To proxy /runs same-origin instead of cross-origin fetch, add a `rewrites`
//   block here that forwards /runs and /runs/:id* to the Fastify origin. That
//   would let us drop NEXT_PUBLIC_API_URL and the API's CORS config in dev.
// - `transpilePackages` is set so the linked @work-sim/shared workspace
//   package is transpiled by Next's bundler (it ships .ts source, not built JS).
// - `extensionAlias` is needed because @work-sim/shared is authored as
//   ESM-with-`.js`-specifiers TypeScript. Webpack needs to know that an
//   import of './types.js' should resolve to './types.ts' on disk.
// - `outputFileTracingRoot` is pinned to this directory because the repo does
//   NOT use pnpm workspaces (each package owns its own lockfile). Without the
//   pin, a stray root-level lockfile makes Next infer the repo root as the
//   workspace boundary and over-include files at build time.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@work-sim/shared'],
  outputFileTracingRoot: __dirname,
  webpack(cfg) {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return cfg;
  },
};

export default config;
