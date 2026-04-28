// Next.js config. Kept intentionally minimal for the prototype.
//
// Notes for future-us:
// - To proxy /runs same-origin instead of cross-origin fetch, add a `rewrites`
//   block here that forwards /runs and /runs/:id* to the Fastify origin. That
//   would let us drop NEXT_PUBLIC_API_URL and the API's CORS config in dev.
// - `transpilePackages` is set so the linked @work-sim/shared workspace
//   package is transpiled by Next's bundler (it ships .ts source, not built JS).

import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@work-sim/shared'],
};

export default config;
