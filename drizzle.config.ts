import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration — used by `npm run db:push` / `db:generate`.
 * Reads DATABASE_URL from the environment (see .env.example).
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://discoball:discoball@localhost:5432/discoball",
  },
  verbose: true,
  strict: true,
});
