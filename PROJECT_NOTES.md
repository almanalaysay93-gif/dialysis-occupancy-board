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

# Waiting lists feature (Aug 12, current request)
DONE:
- drizzle/schema.ts: waiting_list table (id, patientId varchar64, floorId int, priority enum normal/urgent/veryUrgent, addedBy, joinedAt, admittedAt, status enum waiting/admitted, createdAt)
- Migration 0003 applied: CREATE TABLE waiting_list
- server/machines.ts: listWaiting(floorId), addWaiting, removeWaiting(entryId,floorId), markWaitingUrgent(entryId,floorId,priority) — sorted desc by priority then joinedAt. Imports waitingList.
- server/routers.ts: waiting router (publicProcedure waiting.list {floorId}, protected waiting.add/remove/setPriority). waitingPrioritySchema = enum normal/urgent/veryUrgent. Error codes PATIENT_ID_REQUIRED/PATIENT_ID_TOO_LONG.
- client/src/components/WaitingListPanel.tsx: per-floor list, add-patient inline form (patient id + normal/urgent/very urgent buttons), tiers sorted veryUrgent→urgent→normal, pulsing crimson marker (waitpulse keyframe added in index.css), Priority popover to escalate, Remove button, refetch 5s.
- Home.tsx: WaitingListPanel mounted on scoped per-floor boards (waitingFloorId = floorId when provided; main board excluded). Header has <WaitingCount floorId /> ref — NOT YET DEFINED (TS error: WaitingCount missing). FIX: define WaitingCount component in Home.tsx or remove that line.
REMAINING:
1. Define WaitingCount (small component: trpc.waiting.list query, shows "N waiting" with veryUrgent in crimson) or simplify header.
2. Vitest tests server/waiting.test.ts (list sorted, add guards, remove, setPriority) — mock ./machines.
3. pnpm check + pnpm test (currently 31 passing).
4. Mark todo.md items [x], checkpoint, deliver.
Floor IDs: SKTI Main=30001 (100 machines), RDU Annex=30002 (36), RDU Main=30003 (24). Board pages: /floor/30001 etc. Sidebar "Floor Boards" group. Dev: https://3000-...; Prod published: dialysisdash-dn9aztnn.manus.space (auto-publish on checkpoint).
SKTI palette: navy #1F2A52 (ink), crimson #9E1F2B (urgent), green #3E8A6A (in treatment), teal #2E9A9B (isolation/teal), light bg #F4F7F8/#FBFCFD, border #D4DFE5, detail #7684A0.

# Remaining gaps (post-verification, before checkpoint)
1. WaitingListPanel.tsx line: `const { isAuthenticated } = { isAuthenticated: true };` — hardcodes true. FIX: use useAuth() hook from @/_core/hooks/useAuth and gate Add/Priority/Remove controls behind isAuthenticated (auth gate banner like Home.tsx line ~225 pattern).
2. Admit flow not implemented yet: original request said "option to tag admit next patient onto vacant machine". Plan: add waiting.admit procedure (protected) that picks top waiting patient for floor, assigns session to a vacant machine (requires durationMinutes, isolationTag, urgent inputs) + removes waiting row (mark admittedAt/status). UI: "Admit Next Patient" button in WaitingListPanel header (enabled when a vacant machine exists on that floor) — opens small dialog OR quick admit. Keep simple: inline dialog asking duration+tag+urgent before admitting.
3. After fixes: pnpm test (expect 39+), checkpoint, deliver.
Floor IDs: SKTI Main=30001 (100 machines), RDU Annex=30002 (36), RDU Main=30003 (24). waiting_list table exists (migration 0003). Current checkpoint before this feature: 6ce2c8b0.

# Waiting list admit flow state (latest)
DONE (backend):
- machines.ts: countVacantMachines + admitWaiting added (admit starts session on first vacant machine + marks waiting entry admitted; throws NO_WAITING_PATIENT/NO_VACANT_MACHINE).
- routers.ts: waiting.vacantCount (public), waiting.admit (protected; returns {success, patientId}; error messages for no vacant/no patient).
WaitingListPanel.tsx edits applied so far:
- useAuth + startLogin imported; isAuthenticated real (was hardcoded).
- vacantCount query; admitDraft state; admitMut mutation (uses res.patientId).
- Header Add Patient gated behind isAuthenticated (else sign-in button).
- admitDisabledReason + isAdmitDisabled computed.
- Admit draft form added (duration 3/6/8h buttons + clean/dirty + submit crimson "Admit Patient" button + Cancel). NOTE: setAdmitDraft callback for duration uses "mins as 180|360|480" cast in arrow fn — needs explicit state type (durationMinutes: number ok).
- WaitingRow usages now pass admitDraft/setAdmitDraft/isAdmitDisabled/admitDisabledReason/isAuthenticated props — BUT WaitingRow definition NOT yet updated => TS errors at ~line 335/394-396 (broken JSX after section end). Need to: (1) update RowProps + WaitingRow signature, (2) fix dangling JS expression errors (check line 330-400: possibly leftover expression from partial edit where `</div>\n      )}` placement broke).
REMAINING:
1. Fix WaitingListPanel TS errors (~6).
2. Update WaitingRow: add "Admit" button when not in admitDraft; disabled when isAdmitDisabled (tooltip admitDisabledReason); click sets setAdmitDraft({entry, durationMinutes: 240, isolationTag: "clean", urgent: entry.priority!=="normal"}).
3. Vitest: add admit tests to waiting.test.ts (mock countVacantMachines + admitWaiting), update vi.mock with admitWaiting countVacantMachines.
4. pnpm test + check, seed verify, clean waiting rows, checkpoint, deliver.
Floor IDs: SKTI Main=30001 (100), RDU Annex=30002 (36), RDU Main=30003 (24). Checkpoint before this feature: 6ce2c8b0. SKTI palette: navy #1F2A52, crimson #9E1F2B, green #3E8A6A, teal #2E9A9B, bg #F4F7F8/#FBFCFD, border #D4DFE5, detail #7684A0.
