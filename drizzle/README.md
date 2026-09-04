# Migration state

The runtime connects with `drizzle-orm/node-postgres`, but the migration history in this folder was generated for MySQL.
Every `drizzle-kit` command failed with `drizzle/meta/0000_snapshot.json data is malformed` because the journal declared the MySQL dialect while the config declared `postgresql`.

The MySQL history is archived under `legacy-mysql/`.
It is never applied.
`0000_baseline.sql` replaces it and describes the current schema in Postgres.

## The live database is behind the baseline

Checked against production on 2026-09-04.
The database has 8 of the 13 tables in `0000_baseline.sql`.
These five are absent from every schema:

- `infection_surveillance`
- `inventory_supplies`
- `session_complications`
- `shift_endorsements`
- `water_quality_logs`

`server/routers.ts` and `server/machines.ts` query all five, so those endpoints fail in production today.

The database also has a table named `sktiapphd` that `drizzle/schema.ts` does not declare.
Leave it alone until someone confirms what writes to it.

`drizzle.__drizzle_migrations` does not exist yet, in any schema.

### Order of work

1. Apply `manual/0003_missing_clinical_tables.sql`.
   It creates only the five missing tables.
   It has no enums and no foreign keys, so it is additive.
2. Confirm all 13 tables are present.
3. Only then mark the baseline as applied:

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('1f4e2b28e7f82f83d013565398d43af78b885a3d5d7b761383f41839b8698dbc', 1788508886147);
```

drizzle-kit hashes the exact bytes of the file, so recompute with `sha256sum drizzle/0000_baseline.sql` if the baseline is ever regenerated.
The `created_at` value must match the `when` field for `0000_baseline` in `meta/_journal.json`.

Do not run step 3 before step 1.
The row tells drizzle-kit that all 13 tables exist, and the five missing ones would then never be created.

After the row exists, `drizzle-kit migrate` skips the baseline and applies only later migrations.

## manual/

`manual/` holds statements that drizzle-kit does not generate.
Apply them by hand.
They are not part of the journal.
