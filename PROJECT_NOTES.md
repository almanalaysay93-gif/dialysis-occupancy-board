# SKTI rebrand (current request) — state

DONE: logo uploaded to /manus-storage/skti-logo_1a83b735.jpg (local copy: /home/ubuntu/webdev-static-assets/skti-logo.jpg). index.css theme tokens swapped from cream palette to SKTI palette (background pale ivory #F4F7F8 via oklch 0.972 0.006 230; foreground/navy primary #1F2A52; secondary pale teal; accent teal #2E9A9B; destructive crimson #9E1F2B; borders cool slate). Tile states updated: vacant cool light, occupied green (oklch 0.45 0.09 160), urgent crimson with crimson pulse. DashboardLayout: SKTI logo in sidebar header (full + collapsed states) and on sign-in page, wordmark "Dialysis." with teal period + smallcaps "SPMC Kidney & Transplant"; sidebar/mobile header moved to semantic tokens. All hardcoded legacy hex in components/pages bulk-replaced via sed to SKTI codes. ManusDialog.tsx untouched (framework component). index.html title -> "SPMCKTI Dialysis Board — Hemodialysis Occupancy". pnpm check OK, pnpm test OK (17 tests).

REMAINING: screenshot verify all 3 pages (/ , /rooms, /urgent); mark todo.md rebrand items [x]; checkpoint; deliver. Prior checkpoint: 99345eb4.

# SKTI palette mapping
background #F4F7F8 | foreground/primary #1F2A52 navy | secondary pale teal #E8EFF1 | accent teal #2E9A9B | destructive crimson #9E1F2B | muted slate #556680 | border #D4DFE5 | occupied green #3E8A6A | urgent crimson | sidebar pale grey.

# Rooms page (previous request, done)
/rooms lists rooms, add/remove with guards (blocks if machines/sessions exist), 8 tests. Checkpoint 99345eb4.

# Floors (previous request, done)
Floors 1/2/3 with 100/36/24 machines = 160 total. Board rows per floor, compact chips. Add Machine dialog exists.

# Floor rename feature (Aug 12, current request)
DONE (backend): renameRoom helper in server/machines.ts (trims, max 64 chars, duplicate check with sql id <> param, errors ROOM_NAME_REQUIRED/ROOM_NAME_TOO_LONG/ROOM_EXISTS). rooms.rename protectedProcedure added in server/routers.ts with error mapping.
REMAINING:
1. UI: RenameRoomDialog (follow AddRoomDialog pattern at client/src/components/AddRoomDialog.tsx) + wire into Rooms.tsx row three-dot menu (existing menu has Remove; add Rename).
2. Apply renames via SQL (webdev_execute_sql): floor 30001 "Floor 1" → "SKTI Main"; 30002 "Floor 2" → "RDU Annex"; 30003 "Floor 3" → "RDU Main". (Verify current names first — SELECT id,name FROM floors.)
3. Vitest tests for renameRoom guards (server/rooms.test.ts exists with 8 tests).
4. pnpm check + pnpm test, mark todo.md items [x], checkpoint, deliver.
Floor IDs are auto-increment bigints 30001-30003. Sidebar "Floor Boards" group in DashboardLayout.tsx loads floors.name dynamically via trpc.machines.listFloors.useQuery.
