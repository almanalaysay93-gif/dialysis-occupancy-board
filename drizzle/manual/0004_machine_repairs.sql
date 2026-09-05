-- Machine repairs table for historical maintenance logs
CREATE TABLE IF NOT EXISTS "machine_repairs" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"reportedAt" timestamp DEFAULT now() NOT NULL,
	"resolvedAt" timestamp,
	"reportedBy" varchar(64) NOT NULL,
	"technician" varchar(64),
	"issue" text NOT NULL,
	"actionTaken" text,
	"partsReplaced" text,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "machine_repairs_machine_status_idx" ON "machine_repairs" ("machineId", "status");
CREATE INDEX IF NOT EXISTS "machine_repairs_reported_at_idx" ON "machine_repairs" ("reportedAt");
