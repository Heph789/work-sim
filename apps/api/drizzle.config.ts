// drizzle-kit configuration. `pnpm db:push` reads this to know where the
// schema file is and how to connect to SQLite.
//
// For the prototype we use `push` (apply schema directly). When there's a
// shared dev DB we'll switch to `generate` + a versioned migration runner.

// DEPENDENCY: drizzle-kit
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    // Defaults to a file next to the api package. Override with DATABASE_URL.
    url: process.env.DATABASE_URL ?? './work-sim.db',
  },
  // Loose during prototype; revisit as the schema firms up.
  verbose: true,
  strict: true,
} satisfies Config;
