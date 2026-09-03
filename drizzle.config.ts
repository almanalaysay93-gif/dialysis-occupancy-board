import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  // The runtime connects through drizzle-orm/node-postgres, so this must be
  // postgresql. The migrations in ./drizzle predate this fix and are MySQL
  // syntax; they do not apply to the live database.
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
