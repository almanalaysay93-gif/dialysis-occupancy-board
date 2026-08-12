# Project TODO — Hemodialysis Occupancy Board

## Backend
- [x] Add `machines` and `sessions` tables to drizzle/schema.ts
- [x] Generate and apply database migration
- [x] Query helpers implemented in server/machines.ts (list machines, assign session, end session, toggle urgent, update tag)
- [x] tRPC procedures: machines.list, sessions.assign, sessions.end, sessions.toggleUrgent, sessions.updateTag
- [x] Polling/refetch setup for real-time cross-device sync (auto-refetch every 5s)

## Frontend
- [x] Editorial design system: cream background, Didone serif headline (Playfair Display), lighter serif subhead (Cormorant), sans details (Inter), fine geometric lines, generous negative space
- [x] Sidebar dashboard layout with navigation (Occupancy Board, Urgent Cases)
- [x] Machine occupancy grid with in-use vs vacant visual indicators
- [x] Session assignment dialog: patient identifier, duration (3/6/8h), clean/dirty tag, optional urgent flag
- [x] Live countdown timer displayed on each occupied machine tile (client-side countdown synced to server end-time)
- [x] Urgent/priority flag toggle with prominent visual highlight (pulsing red tile)
- [x] Clean/dirty isolation tag display and per-session update
- [x] End/release session control returning machine to vacant
- [x] Header status summary (machines in use, urgent count, vacancy, isolation)
- [x] DashboardLayout integration with auth handling

## Quality
- [x] Vitest unit tests for session router procedures
- [x] Visual verification via screenshots (desktop board + urgent register with seeded sessions, mobile layout)
- [x] TypeScript check passes

## Floor rows & machine management (new request)
- [x] Add `floors` table to schema and floorId column on machines
- [x] Migrate seed data: Floor 1 = 100 machines, Floor 2 = 36, Floor 3 = 24 (total 160)
- [x] Backend: floor listing, add machine (protected), remove machine
- [x] UI: floor-based rows/sections on the board, compact tile rows (FloorMachineRow chips)
- [x] UI: Add Machine dialog/control for staff
- [x] Per-floor stats in each floor heading (vacant/in-use/urgent)
- [x] Update tests (pnpm test 9 passing), verify screenshots, checkpoint

## Rooms management page (new request)
- [x] Backend: rooms.add (protected), rooms.remove (protected, blocks if machines/sessions exist)
- [x] New /rooms page: editorial list of rooms with machine counts and occupancy stats
- [x] Add Room dialog and Remove Room confirmation with safety guards (must be empty of machines)
- [x] Wire Rooms into sidebar navigation (DashboardLayout)
- [x] Vitest coverage for room add/remove guards (8 new tests, 17 passing); screenshots verified; checkpoint

## SKTI rebrand (new request)
- [x] Upload SKTI logo asset via manus-upload-file --webdev
- [x] Update theme tokens (index.css): navy ink, crimson red, teal/green accents replacing cream/ink palette
- [x] Sidebar branding: SKTI logo + updated wordmark ("Dialysis." + "SPMC Kidney & Transplant") + sign-in page logo
- [x] Page headers/boards updated to SPMCKTI identity and palette (all legacy hex replaced; index.html title updated)
- [x] Verify colors and logo rendering on all pages (/ /rooms /urgent), checkpoint, deliver

## Machine rename & custom duration (new request)
- [x] Backend: machines.updateLabel (protected, rename machine label) + sessions.assign accepts custom duration (numeric minutes, 15–1440, not just 3/6/8)
- [x] UI: rename machine from vacant tile hover menu (RenameMachineDialog)
- [x] UI: "Custom" duration option in assign dialog with hours/minutes inputs
- [x] Vitest coverage for rename and custom duration (8 new tests, 25 passing); verify; checkpoint

## Per-floor occupancy boards (new request)
- [x] Support a floor filter parameter on the board so a single board view can show one floor only (shared OccupancyBoard component with floorId prop)
- [x] New routes: /floor/:id showing only that floor's machines (/floor/30002 = Floor 2, /floor/30003 = Floor 3)
- [x] Sidebar navigation entries: "Floor Boards" group with one entry per floor (loaded dynamically from the floors table)
- [x] Verify per-floor boards render with scoped stats; checkpoint

## Floor rename (new request)
- [x] Backend: rooms.rename procedure (protected, validates name 1–64 chars, duplicate check, error mapping)
- [x] UI: RenameRoomDialog on the Rooms page (Rename button + Pencil icon per room row)
- [x] Applied new names: 30001 → SKTI Main, 30002 → RDU Annex, 30003 → RDU Main (sidebar + board headers update dynamically)
- [x] Vitest coverage (6 new rename tests, 31 passing), screenshots verified, checkpoint

## Waiting lists (new request)
- [x] Schema: add `waitingList` table (patientId, floorId, priority: normal/urgent/veryUrgent, addedBy, joinedAt, admittedAt nullable, status waiting/admitted)
- [x] Migration 0003 applied via webdev_execute_sql
- [x] Backend helpers in server/machines.ts: listWaiting / addWaiting / removeWaiting / markWaitingUrgent (sorted desc priority, then joinedAt)
- [x] tRPC procedures: waiting.list (public, by floor), waiting.add/remove/setPriority (protected), waiting.vacantCount (public), waiting.admit (protected, starts session on first vacant machine, marks entry admitted; returns patientId; NO_WAITING_PATIENT/NO_VACANT_MACHINE error mapping)
- [x] Backend helpers: countVacantMachines + admitWaiting (veryUrgent patients auto-flagged urgent on admission)
- [x] UI: WaitingListPanel per board page with inline add-patient form (patient ID + Normal/Urgent/Very Urgent buttons), auth-gated
- [x] Three-tier queue: very urgent on top (pulsing crimson Siren marker, waitpulse keyframe in index.css), urgent middle, normal last
- [x] Per-row Admit button → draft form (duration 3/6/8h buttons, clean/dirty tag, Admit Patient submit, Cancel)
- [x] Priority popover to escalate/de-escalate + Remove button per waiting patient
- [x] Header stat WaitingCount per board with very-urgent count in crimson
- [x] Vitest coverage (14 waiting tests incl. admit/vacantCount, 45 passing total), screenshots verified with seeded patients, board delivered clean, checkpoint
