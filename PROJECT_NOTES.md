# Project Notes — dialysis-occupancy-board

## User requirements history
1. Initial: internal clinical staff tool, editorial design (cream bg #F6F1E7, Didone serif Playfair Display 900 headline, Cormorant Garamond 500 subhead, Inter sans details with smallcaps 0.3em letter-spacing), sidebar nav. Features: occupancy grid (in-use green vs vacant), real-time sync (5s polling), 3/6/8h countdown timers, urgent flag (pulsing red tile), clean/dirty isolation tags, assign dialog (patient id, duration, tag, urgent), end session, dashboard layout with sidebar.
2. NEW request: dashboard of machines in ROWS grouped by floor. Floors: Floor 1 = 100 machines, Floor 2 = 36, Floor 3 = 24 (total 160). Option to add more machines (staff-managed machine inventory).

## Current state
- Published domain: dialysisdash-dn9aztnn.manus.space (Autoscale hosting)
- Checkpoint delivered: c15ab968
- Schema (drizzle/schema.ts): `machines` (id, label, location, sortOrder) and `sessions` (machineId, patientId, durationMinutes 180/360/480, startedAt, endsAt, isolationTag clean/dirty, urgent, status active/ended, endedAt, endedBy, startedBy)
- Server logic in server/machines.ts: listMachines, assignSession (checks duplicate active session → throws "MACHINE_OCCUPIED"), endSession, toggleUrgent (sql NOT urgent), updateIsolationTag
- tRPC routers in server/routers.ts: machines.list (public), sessions.assign/end/toggleUrgent/updateTag (protected)
- UI: client/src/components/MachineTile.tsx (vacant tile / occupied green tile / urgent red pulsing tile, countdown MM:SS left, clean/dirty badge, dropdown with mark urgent, toggle tag, end session), AssignSessionDialog.tsx, EndSessionDialog.tsx, pages/Home.tsx (masthead stats, grid), pages/Urgent.tsx (urgent register)
- Tests: server/sessions.test.ts (9 passing), plus template auth.logout.test.ts. pnpm test + pnpm check pass.
- 16 machines seeded as HD-01..HD-16 in Bays A-D.
- Design tokens in index.css: --background cream oklch(0.955 0.018 85), tile-vacant/tile-occupied green oklch(0.42 0.085 160)/tile-urgent red oklch(0.45 0.17 27) with urgent-pulse animation, tile-enter stagger, smallcaps-detail utility, font-display/font-serif-light classes.

## Verified state (post floor implementation)
- DB now has floors table with real IDs (F1=30001, F2=30002, F3=30003; auto-increment offset 30000). 160 machines with floorId matching real IDs. seed-floors.mjs now queries real floor IDs.
- Floor rows UI verified: Floor 1 (100), Floor 2 (36), Floor 3 (24) each rendered as a band with heading stats. Occupied green chips with timer (005 chip shows 02:59:54), urgent red chips (005 had urgent; note 110 urgent too), dirty tag shown via Droplets icon on dirty chip (60145 = HD-145, dirty).
- Header stats update per-floor (e.g. Floor 1: 99 vacant, 1 in use, 1 urgent). Total: 157 vacant/3 in use/2 urgent/1 isolation.
- AddMachineDialog built; Add Machine button in footer bar. Machines.remove exists server-side but no UI button yet (not requested explicitly).
- pnpm test passes (9 tests), pnpm check passes. Demo sessions seeded in machines 60005/60110 (urgent) + 60145 (dirty) — MUST remove before checkpoint delivery (webdev_execute_sql DELETE FROM sessions).
- Old MachineTile.tsx still exists but is now UNUSED (replaced by FloorMachineRow.tsx chips); safe to delete.

## Rooms management page (current request, nearly done)
- DONE: server/machines.ts addRoom (ROOM_EXISTS guard), removeRoom (ROOM_HAS_ACTIVE_SESSIONS / ROOM_HAS_MACHINES guards). routers.ts has rooms.list (public), rooms.add + rooms.remove (protected, TRPCError CONFLICT msgs). server/rooms.test.ts 8 new tests, 17 tests total passing.
- DONE: client/src/components/AddRoomDialog.tsx (name input), RemoveRoomDialog.tsx (confirm, disabled if machines>0), Rooms.tsx page (editorial: header + Add Room btn, room rows w/ badge machine count + occupancy bar + Remove btn, footer note), sidebar nav entry "Rooms" -> /rooms (LayoutGrid icon).
- REMAINING: register <Route path="/rooms" component={Rooms}/> in App.tsx; screenshot verify /rooms; update todo.md; checkpoint; deliver. Published domain: dialysisdash-dn9aztnn.manus.space (auto-publish on checkpoint). Current checkpoint: d392d7d1.
- Note: rooms.remove throws errors only from DB side; if room removal fails w/ machines, dialog disabled btn. rooms.list returns floors rows: {id, code, name, sortOrder, createdAt}.

## TODO for new request
- [ ] Add `floors` table (id, name, label, sortOrder); add floorId FK (nullable ok) to machines
- [ ] Seed: Floor 1 = 100 machines (HD-001..HD-100), Floor 2 = 36 (HD-101..HD-136), Floor 3 = 24 (HD-137..HD-160); keep existing HD-01..HD-16 rows — migrate to floors or drop. Better: replace old 16 machines with 160 floor-grouped ones (drop old rows first).
- [ ] Backend: machines.add (protected, label + floorId + location), machines.listFloors, machines.remove (or keep only add)
- [ ] UI: group grid by floor rows/sections; each floor = row band with floor heading + machine tiles in compact row; add "Add Machine" control (dialog: label, floor, location)
- [ ] Stats bar should reflect floors: total/in-use/vacant/urgent/isolation
- [ ] Update vitest tests; run pnpm test + pnpm check; seed demo sessions removed before delivery (keep DB clean)
