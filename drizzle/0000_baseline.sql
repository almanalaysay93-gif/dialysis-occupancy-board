CREATE TYPE "public"."machine_status" AS ENUM('active', 'backup', 'repair');--> statement-breakpoint
CREATE TYPE "public"."isolation_tag" AS ENUM('clean', 'dirty');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('nurse', 'supervisor', 'guest', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."waiting_isolation_tag" AS ENUM('clean', 'dirty');--> statement-breakpoint
CREATE TYPE "public"."waiting_priority" AS ENUM('normal', 'urgent', 'veryUrgent');--> statement-breakpoint
CREATE TYPE "public"."waiting_status" AS ENUM('waiting', 'admitted');--> statement-breakpoint
CREATE TABLE "floors" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" varchar(64) NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "floors_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "infection_surveillance" (
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
--> statement-breakpoint
CREATE TABLE "inventory_supplies" (
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
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar(32) NOT NULL,
	"location" varchar(64) NOT NULL,
	"floorId" integer,
	"status" "machine_status" DEFAULT 'active' NOT NULL,
	"statusNote" varchar(256),
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "narrative_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"narrative_id" integer,
	"floor_id" integer NOT NULL,
	"report_date" varchar(10) NOT NULL,
	"period_key" varchar(16) NOT NULL,
	"action" varchar(10) NOT NULL,
	"actor" varchar(64) NOT NULL,
	"actor_role" varchar(32),
	"body_snapshot" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "narrative_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"floorId" integer NOT NULL,
	"reportDate" varchar(10) NOT NULL,
	"periodKey" varchar(16) NOT NULL,
	"shiftKey" varchar(16),
	"author" text NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_complications" (
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
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"patientId" varchar(64) NOT NULL,
	"durationMinutes" integer NOT NULL,
	"startedAt" timestamp NOT NULL,
	"endsAt" timestamp NOT NULL,
	"isolationTag" "isolation_tag" DEFAULT 'clean' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"displayLabel" varchar(64),
	"assignedNurse" varchar(64),
	"needsRepairAfterSession" boolean DEFAULT false NOT NULL,
	"pausedAt" timestamp,
	"pausedSeconds" integer DEFAULT 0 NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"endedAt" timestamp,
	"endedBy" text,
	"startedBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_endorsements" (
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
--> statement-breakpoint
CREATE TABLE "staff_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(64) NOT NULL,
	"displayName" varchar(64) NOT NULL,
	"role" "staff_role" NOT NULL,
	"assignedFloorId" integer,
	"passwordHash" varchar(128) NOT NULL,
	"passwordSalt" varchar(32) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp,
	"tokenVersion" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_accounts_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" varchar(16) DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "waiting_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"patientId" varchar(64) NOT NULL,
	"floorId" integer NOT NULL,
	"priority" "waiting_priority" DEFAULT 'normal' NOT NULL,
	"durationMinutes" integer DEFAULT 240 NOT NULL,
	"isolationTag" "waiting_isolation_tag" DEFAULT 'clean' NOT NULL,
	"assignedNurse" varchar(64),
	"addedBy" text,
	"joinedAt" timestamp DEFAULT now() NOT NULL,
	"admittedAt" timestamp,
	"status" "waiting_status" DEFAULT 'waiting' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "water_quality_logs" (
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
--> statement-breakpoint
CREATE INDEX "machines_floor_status_idx" ON "machines" USING btree ("floorId","status");--> statement-breakpoint
CREATE INDEX "narrative_history_floor_date_idx" ON "narrative_history" USING btree ("floor_id","report_date");--> statement-breakpoint
CREATE INDEX "narrative_reports_floor_date_idx" ON "narrative_reports" USING btree ("floorId","reportDate");--> statement-breakpoint
CREATE INDEX "session_complications_session_idx" ON "session_complications" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "sessions_active_machine_idx" ON "sessions" USING btree ("machineId") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "sessions_active_started_idx" ON "sessions" USING btree ("startedAt") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "sessions_ended_at_idx" ON "sessions" USING btree ("endedAt") WHERE status = 'ended';--> statement-breakpoint
CREATE INDEX "shift_endorsements_floor_date_idx" ON "shift_endorsements" USING btree ("floorId","date");--> statement-breakpoint
CREATE INDEX "waiting_list_status_floor_idx" ON "waiting_list" USING btree ("status","floorId");--> statement-breakpoint
CREATE INDEX "water_quality_logs_floor_date_idx" ON "water_quality_logs" USING btree ("floorId","date");