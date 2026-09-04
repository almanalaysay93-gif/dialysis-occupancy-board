import { defineConfig } from "drizzle-kit";
import { requireDatabaseUrl } from "./server/_core/database-url";

// Same precedence as the runtime pool: a Supabase-only deploy sets
// SUPABASE_DATABASE_URL_B64 and never sets DATABASE_URL.
const connectionString = requireDatabaseUrl();

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  // The runtime connects through drizzle-orm/node-postgres, so this must be
  // postgresql. The original MySQL-era migrations are archived under
  // ./drizzle/legacy-mysql and are not applied by drizzle-kit.
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
