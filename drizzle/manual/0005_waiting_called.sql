-- Nurse "Call patient in" state on the waiting queue.
-- Set when a nurse calls the patient to the treatment area, cleared on cancel.
-- Additive and nullable, so existing rows and queries are unaffected.
ALTER TABLE "waiting_list" ADD COLUMN IF NOT EXISTS "calledAt" timestamp;
ALTER TABLE "waiting_list" ADD COLUMN IF NOT EXISTS "calledBy" varchar(64);
