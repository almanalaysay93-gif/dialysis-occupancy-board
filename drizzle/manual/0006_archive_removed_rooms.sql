-- Preserve historical waiting-list foreign keys when retiring a room.
ALTER TABLE "public"."floors"
  ADD COLUMN IF NOT EXISTS "archivedAt" timestamptz;
