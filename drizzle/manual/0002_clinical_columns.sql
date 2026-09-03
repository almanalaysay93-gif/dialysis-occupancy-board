-- Clinical record columns: RO water QC, adverse complications, shift handover.
--
-- These carry the fields the clinical forms already capture. Before this the
-- forms wrote to browser localStorage, so nothing they recorded survived a
-- device change or reached another nurse.
--
-- Applied out of band for the same reason as 0001: drizzle.config.ts declared
-- dialect "mysql" while the runtime connects with drizzle-orm/node-postgres.
--
-- Idempotent: safe to run more than once.
-- Run with: psql "$DATABASE_URL" -f drizzle/manual/0002_clinical_columns.sql

ALTER TABLE shift_endorsements
  ADD COLUMN IF NOT EXISTS "floorName" varchar(64),
  ADD COLUMN IF NOT EXISTS "situation" text,
  ADD COLUMN IF NOT EXISTS "background" text,
  ADD COLUMN IF NOT EXISTS "assessment" text,
  ADD COLUMN IF NOT EXISTS "recommendations" text,
  ADD COLUMN IF NOT EXISTS "censusJson" text,
  ADD COLUMN IF NOT EXISTS "checklistJson" text,
  ADD COLUMN IF NOT EXISTS "specialWatchJson" text,
  ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "endorsedAt" timestamp;

ALTER TABLE session_complications
  ADD COLUMN IF NOT EXISTS "machineId" integer,
  ADD COLUMN IF NOT EXISTS "machineLabel" varchar(32),
  ADD COLUMN IF NOT EXISTS "floorId" integer,
  ADD COLUMN IF NOT EXISTS "patientId" varchar(64),
  ADD COLUMN IF NOT EXISTS "patientDisplayAlias" varchar(64),
  ADD COLUMN IF NOT EXISTS "date" varchar(16),
  ADD COLUMN IF NOT EXISTS "timeOfDay" varchar(8),
  ADD COLUMN IF NOT EXISTS "nurseName" varchar(96),
  ADD COLUMN IF NOT EXISTS "severity" varchar(32),
  ADD COLUMN IF NOT EXISTS "preEventBp" varchar(16),
  ADD COLUMN IF NOT EXISTS "eventBp" varchar(16),
  ADD COLUMN IF NOT EXISTS "heartRate" integer,
  ADD COLUMN IF NOT EXISTS "spo2" integer,
  ADD COLUMN IF NOT EXISTS "bfr" integer,
  ADD COLUMN IF NOT EXISTS "ufr" integer,
  ADD COLUMN IF NOT EXISTS "interventionsJson" text,
  ADD COLUMN IF NOT EXISTS "salineBolusVolumeMl" integer,
  ADD COLUMN IF NOT EXISTS "physicianNotified" varchar(96),
  ADD COLUMN IF NOT EXISTS "outcome" varchar(64),
  ADD COLUMN IF NOT EXISTS "notes" text;

ALTER TABLE water_quality_logs
  ADD COLUMN IF NOT EXISTS "timeOfDay" varchar(8),
  ADD COLUMN IF NOT EXISTS "shift" varchar(48),
  ADD COLUMN IF NOT EXISTS "inspectorRole" varchar(32),
  ADD COLUMN IF NOT EXISTS "feedTds" real,
  ADD COLUMN IF NOT EXISTS "productTds" real,
  ADD COLUMN IF NOT EXISTS "rejectionRate" real,
  ADD COLUMN IF NOT EXISTS "productConductivity" real,
  ADD COLUMN IF NOT EXISTS "waterHardnessPpm" real,
  ADD COLUMN IF NOT EXISTS "loopFeedPressure" real,
  ADD COLUMN IF NOT EXISTS "loopReturnPressure" real,
  ADD COLUMN IF NOT EXISTS "waterTemperatureC" real,
  ADD COLUMN IF NOT EXISTS "totalChlorine" real,
  ADD COLUMN IF NOT EXISTS "chloramineBreakthrough" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "heatDisinfectionCompleted" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "heatPeakTemp" real,
  ADD COLUMN IF NOT EXISTS "heatHoldMinutes" integer,
  ADD COLUMN IF NOT EXISTS "chemicalAgentUsed" varchar(48),
  ADD COLUMN IF NOT EXISTS "residualChemicalTestNegative" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "endotoxinLevel" real,
  ADD COLUMN IF NOT EXISTS "colonyCount" integer,
  ADD COLUMN IF NOT EXISTS "correctiveAction" text,
  ADD COLUMN IF NOT EXISTS "notes" text;

-- The clinical pages read the newest entries for a floor and date.
CREATE INDEX IF NOT EXISTS water_quality_logs_floor_date_idx
  ON water_quality_logs ("floorId", "date");

CREATE INDEX IF NOT EXISTS shift_endorsements_floor_date_idx
  ON shift_endorsements ("floorId", "date");

CREATE INDEX IF NOT EXISTS session_complications_session_idx
  ON session_complications ("sessionId");
