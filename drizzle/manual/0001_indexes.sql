-- Performance indexes for the occupancy board and reports.
--
-- Applied out of band because drizzle.config.ts still declares dialect "mysql"
-- while the runtime connects with drizzle-orm/node-postgres, so drizzle-kit
-- cannot generate a correct migration for this database.
--
-- Idempotent: safe to run more than once.
-- Run with: psql "$DATABASE_URL" -f drizzle/manual/0001_indexes.sql

-- Board poll: active session per machine. Partial, so it stays a few dozen
-- rows regardless of how much session history accumulates.
CREATE INDEX IF NOT EXISTS sessions_active_machine_idx
  ON sessions ("machineId") WHERE status = 'active';

CREATE INDEX IF NOT EXISTS sessions_active_started_idx
  ON sessions ("startedAt") WHERE status = 'active';

-- End of Day / End of Month scan completed sessions by end time.
CREATE INDEX IF NOT EXISTS sessions_ended_at_idx
  ON sessions ("endedAt") WHERE status = 'ended';

-- The waiting queue is always read as "still waiting, on this floor".
CREATE INDEX IF NOT EXISTS waiting_list_status_floor_idx
  ON waiting_list (status, "floorId");

-- Floor boards and reports filter machines by floor and status.
CREATE INDEX IF NOT EXISTS machines_floor_status_idx
  ON machines ("floorId", status);

CREATE INDEX IF NOT EXISTS narrative_reports_floor_date_idx
  ON narrative_reports ("floorId", "reportDate");

CREATE INDEX IF NOT EXISTS narrative_history_floor_date_idx
  ON narrative_history (floor_id, report_date);
