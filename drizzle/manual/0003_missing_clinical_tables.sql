-- Tables that drizzle/schema.ts declares and the live database is missing.
-- Verified against production on 2026-09-04: 8 of 13 tables existed.
-- Copied verbatim from 0000_baseline.sql. No enums, no foreign keys, additive only.

CREATE TABLE IF NOT EXISTS "infection_surveillance" (
	"id" serial PRIMARY KEY NOT NULL,
	"patientId" varchar(64) NOT NULL,
	"hbsagStatus" varchar(32) DEFAULT 'negative' NOT NULL,
	"hcvStatus" varchar(32) DEFAULT 'negative' NOT NULL,
	"hivStatus" varchar(32) DEFAULT 'negative' NOT NULL,
	"mdrStatus" varchar(32) DEFAULT 'negative' NOT NULL,
	"lastTestedDate" varchar(16),
	"assignedIsolationRoom" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "inventory_supplies" (
	"id" serial PRIMARY KEY NOT NULL,
	"itemCode" varchar(64) NOT NULL,
	"itemName" varchar(128) NOT NULL,
	"unit" varchar(32) NOT NULL,
	"currentStock" integer DEFAULT 0 NOT NULL,
	"reorderLevel" integer DEFAULT 10 NOT NULL,
	"category" varchar(64) DEFAULT 'general' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_supplies_itemCode_unique" UNIQUE("itemCode")
);

CREATE TABLE IF NOT EXISTS "session_complications" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer NOT NULL,
	"complicationType" varchar(64) NOT NULL,
	"onsetMinutes" integer,
	"intervention" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"machineId" integer,
	"machineLabel" varchar(32),
	"floorId" integer,
	"patientId" varchar(64),
	"patientDisplayAlias" varchar(64),
	"date" varchar(16),
	"timeOfDay" varchar(8),
	"nurseName" varchar(96),
	"severity" varchar(32),
	"preEventBp" varchar(16),
	"eventBp" varchar(16),
	"heartRate" integer,
	"spo2" integer,
	"bfr" integer,
	"ufr" integer,
	"interventionsJson" text,
	"salineBolusVolumeMl" integer,
	"physicianNotified" varchar(96),
	"outcome" varchar(64),
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "shift_endorsements" (
	"id" serial PRIMARY KEY NOT NULL,
	"shift" varchar(32) NOT NULL,
	"floorId" integer NOT NULL,
	"date" varchar(16) NOT NULL,
	"incomingNurse" varchar(64) NOT NULL,
	"outgoingNurse" varchar(64) NOT NULL,
	"patientNotes" text,
	"accessIssues" text,
	"equipmentNotes" text,
	"floorName" varchar(64),
	"situation" text,
	"background" text,
	"assessment" text,
	"recommendations" text,
	"censusJson" text,
	"checklistJson" text,
	"specialWatchJson" text,
	"status" varchar(32) DEFAULT 'DRAFT' NOT NULL,
	"endorsedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "water_quality_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" varchar(16) NOT NULL,
	"floorId" integer NOT NULL,
	"tdsIn" integer,
	"tdsOut" integer,
	"chlorineLevel" varchar(32),
	"hardness" varchar(32),
	"waterTemp" varchar(32),
	"technician" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'pass' NOT NULL,
	"timeOfDay" varchar(8),
	"shift" varchar(48),
	"inspectorRole" varchar(32),
	"feedTds" real,
	"productTds" real,
	"rejectionRate" real,
	"productConductivity" real,
	"waterHardnessPpm" real,
	"loopFeedPressure" real,
	"loopReturnPressure" real,
	"waterTemperatureC" real,
	"totalChlorine" real,
	"chloramineBreakthrough" boolean DEFAULT false NOT NULL,
	"heatDisinfectionCompleted" boolean DEFAULT false NOT NULL,
	"heatPeakTemp" real,
	"heatHoldMinutes" integer,
	"chemicalAgentUsed" varchar(48),
	"residualChemicalTestNegative" boolean DEFAULT false NOT NULL,
	"endotoxinLevel" real,
	"colonyCount" integer,
	"correctiveAction" text,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

