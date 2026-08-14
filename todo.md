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

## Admit custom duration (new request)
- [x] Waiting List admit draft form: add "Custom" duration option with hours/minutes inputs (15 min – 24 h)
- [x] Verify form state, wire custom minutes into waiting.admit mutation (draftEffectiveMinutes helper, disabled submit on invalid range)
- [x] Test (tsc + 45 vitest passing), screenshots verified, checkpoint saved and auto-published

## Cross-board urgent aggregation (new request)
- [x] Backend: waiting.urgentRegister publicProcedure + machines.listWaitingAll() helper (urgent-flagged active sessions per floor + very-urgent waiting patients, with floor name and board link)
- [x] Urgent Cases page: all boards' urgent sessions grouped by board (SKTI Main / RDU Annex / RDU Main) with links + very-urgent waiting patients with pulsing cards and Remove action
- [x] Vitest coverage: 3 urgentRegister tests (multi-floor aggregation, very-urgent waiting filter, null floorId); 51 tests passing, tsc clean
- [x] Checkpoint saved and auto-published (live site verify requires staff sign-in; DB transiently unavailable during screenshot seeding)

## 4-hour duration preset everywhere (new request)
- [x] AssignSessionDialog: duration buttons 3 h / 4 h / 6 h / 8 h / Custom (grid-cols-5, DurationValue union, backend z.enum extended)
- [x] WaitingListPanel admit form: duration buttons 3 h / 4 h / 6 h / 8 h / Custom (DurationValue union extended)
- [x] durationLabel helpers updated in FloorMachineRow.tsx and Urgent.tsx to render "4 h" for 240 min
- [x] Vitest: 4h preset acceptance test added; 52 tests passing, tsc clean; screenshot verified board renders

## Editable session title in Assign dialog (user request)
- [x] Sessions table: displayLabel varchar(64) column added; migration applied
- [x] Backend: displayLabel accepted in sessions.assign; sessions.updateLabel procedure added; machines.listMachines returns displayLabel
- [x] AssignSessionDialog: "Edit title" pencil button next to "Assign HD-xxx" opens inline input to set displayLabel
- [x] FloorMachineRow: occupied chip shows displayLabel (truncated 14 chars) with machine number as a small sub-label when set; "Edit highlighted title" in dropdown opens RenameSessionLabelDialog
- [x] RenameSessionLabelDialog: standalone dialog for editing the session title from the chip dropdown
- [x] Tests: 4 new displayLabel tests (persist/trim, clear null/blank, reject >64 chars, assign stores label); 56 tests passing, tsc clean; screenshot verified tile shows BED 4 — P-4821 label correctly

## Per-floor Nurse Patient Assignments list (user request)
- [x] Schema: assignedNurse varchar(64) column added to sessions; migration 0005 applied
- [x] Backend: assignedNurse accepted in sessions.assign + waiting.admit + WaitingListPanel admit; listMachines returns it; waiting.nurseAssignments(floorId) publicProcedure (listNurseAssignments joins sessions+machines, nurses grouped, "Unassigned" group last)
- [x] AssignSessionDialog: optional "Nurse — optional" input, persisted on assign, cleared on success
- [x] NurseAssignmentsPanel: per-floor section on each board listing nurses with patient/machine and live remaining time (green >15m, amber ≤15m, crimson overdue); 5s poll + 30s local countdown; screenshot verified with seeded data
- [x] Tests: 5 new (2 assignedNurse in sessions.test.ts, 3 nurseAssignments in waiting.test.ts); 61 tests passing, tsc clean; checkpoint saved and auto-published

## Bug: floorId must be > 0 error on /floor/30001 (user report)
- [x] Diagnose: root cause found — FloorBoard passed floorId=-1 to OccupancyBoard while the floors query was still loading, firing waiting.list/vacantCount/nurseAssignments with an invalid id that failed zod positive() validation ("Too small: expected number to be >0")
- [x] Fix: FloorBoard now passes floor?.id (undefined while loading), so OccupancyBoard renders unscoped with its skeleton until the floor resolves
- [x] Verify: tsc clean, 61 tests passing, screenshots of /floor/1-3 all render correctly; checkpoint saved and auto-published

## Role-based access + End of Day report
- [x] Schema: staff_accounts table (username, name, role: nurse|supervisor, assignedFloorId nullable, password hash, active flag); sessions already tracked for report data
- [x] Backend: staff.login procedure (password hashed with SHA-256 + salt), staff.me, scoped procedures respecting role + assignedFloorId; supervisor skips scoping (staffOrAdminProcedure + requireFloorAccess in all write procedures incl. sessions.assign/end/toggleUrgent/updateTag/updateLabel via machine/session floor lookup)
- [x] Backend: End of Day report aggregation (endOfDay.summary query + endOfDayReport()) — per board: machines utilized, patients catered, priority counts, isolation, waiting adds, treatment hours; nurse/guest see own board, supervisor sees all
- [x] Frontend: StaffLogin page with Guest mode + username/password nurse/supervisor login; StaffBar mounted in Home masthead and board headers; canWrite gating replaces isAuthenticated across write controls
- [x] Sidebar/navigation scoping: nurses see only their assigned board; supervisors see all; guests see all boards but Rooms hidden and write actions disabled
- [x] Initial staff accounts seeded (supervisor + 3 floor nurses, floor ids 30001/30002/30003)
- [x] End of Day Report page (/report): date picker, per-board cards (supervisor) or single board (nurse/guest), priority breakdown, printable layout; /report route registered
- [x] Vitest: 10 new staff-rbac tests (guest me, invalid/empty login, logout cookie clear, supervisor unscoped summary, nurse auto-scoped + FORBIDDEN on other floor, guest read report, nurse assign FORBIDDEN other-floor machine, guest write UNAUTHORIZED); 71 tests passing, tsc clean
- [x] Screenshots verify login page, staff-gated board, report page; checkpoint, deliver

## Guest hard view-only pass (follow-up request)
- [x] canWrite must be false for role === "guest" (staffCanWrite returns true only for nurse/supervisor; Home/WaitingListPanel/Urgent/Rooms canWrite + FloorMachineRow isStaff all exclude guests)
- [x] Hide End of Day Report nav item and block /report for guests (DashboardLayout filters /report; EndOfDayReport renders staff-only prompt for guests)
- [x] Verify no add-patient/add-machine/admit-to-vacant/end-session/urgent-toggle/tag/edit buttons render for guest on Home, FloorBoard, Urgent, Rooms (code audit: canWrite/isStaff gates everywhere; Rooms page stays viewable but all write controls hidden)
- [x] Fixed ERR_HTTP_HEADERS_SENT crash in setStaffSessionCookie (headersSent guard) that was killing the dev server
- [x] Screenshot guest session end-to-end (/report blocked, /floor/30001 clean grid with "Viewing as guest"), 73 tests passing, tsc clean, checkpoint, deliver

## Guest buttons still visible (user report)
- [x] Root cause: guest staff cookie did not override the OAuth admin session — `canWrite = isAuthenticated || role != "guest"` let a signed-in owner in Guest mode see every write control
- [x] Master fix in Home, Rooms, Urgent, WaitingListPanel (row Admit/Priority/Remove), FloorMachineRow: guest staff role forces canWrite/isStaff false regardless of OAuth login
- [x] Waiting-row action buttons hidden entirely for guests instead of merely disabled
- [x] Verified clean guest view on /floor/30001, /urgent, /rooms (sign-in prompts only, no action icons on tiles); 73 tests passing, tsc clean, checkpoint, deliver

## Supervisor login shows "Guest" on production (user report)
- [x] Reproduce on live site: supervisor login succeeds but staff.me resolves Guest (fromCookie:false)
- [x] Root cause: staff_session_id cookie not persisted on production — SameSite/Secure handling behind the proxy meant the cookie was never retained by the browser (direct fetch on live showed no Set-Cookie carried by a Secure attribute)
- [x] Robust fix in server/_core/cookies.ts: secure=true forced for known production hosts (manus.space/manus.im) regardless of x-forwarded-proto, with sameSite none on production and lax fallback for plain-http dev previews
- [x] Verified supervisor identity on live site after login, tests pass, checkpoint, deliver (root cause was async cookie race: JWT was set after headers flushed — fixed with awaitable setStaffSessionCookieSync; production raw-TLS probes confirm Secure Set-Cookie + staff.me fromCookie:true for supervisor and nurse; demo data cleanup pending)
- [x] Clean up demo data (DEMO SESSION on HD-001, DEMO-WAIT-001 waiting entry removed from production DB — verified 0 remaining)
- [x] Final delivery: staff-credentials.md updated with confirmed logins and persistence note, final report delivered to user

## User audit: every login entry must follow the rules (user request)
- [x] Audit code: staffAuth.ts + routers.ts RBAC guards — fixed machines.remove (was unscoped: any nurse could delete any floor's machine) and rooms management (now supervisor-only)
- [x] Live production verification: supervisor login + scoping + write gates (rooms add/remove, cross-floor machine remove)
- [x] Live production verification: nurse.skti-main scoped to 30001 only (write FORBIDDEN on other floors and rooms.add)
- [x] Live production verification: nurse.rdu-annex scoped to 30002 only
- [x] Live production verification: nurse.rdu-main scoped to 30003 only
- [x] Live production verification: guest mode stays pure view-only (staff.me with/without cookie -> guest; writes require staffOrAdminProcedure)
- [x] Fix any bugs found and publish: token-version revocation (login/logout bump tokenVersion; stale cookies resolve to guest); 2 new vitest tests (85 passing); migration applied to production
- [x] Deliver audit report

## Regression: guest sees action buttons (user report, after merge of commit 8f5505f)
- [x] Reproduce: guest mode shows Add patient, Add machine, Assign next vacant buttons (root cause: pre-fix guest marker cookie was a plain "guest" string whose fromCookie handling failed to lock writes for OAuth owners; fixed by making guest mode issue a signed JWT like nurse/supervisor sessions — checkpoint f928b4aa)
- [x] Fix canWrite so role === guest is false everywhere (OccupancyBoard assign chip, Home add-machine, WaitingListPanel add controls) — all write controls gated by useCanWrite with isGuestMode = role==="guest" && fromCookie===true
- [x] Live production verification: staff.guest returns Secure/HttpOnly/SameSite=None JWT cookie; staff.me resolves role=guest fromCookie=true; machines.add as guest returns 401 UNAUTHORIZED
- [x] Client gating audit: Home, FloorMachineRow, WaitingListPanel, Urgent, Rooms use useCanWrite; FloorBoard reuses gated OccupancyBoard; DashboardLayout hides /rooms and /report for guests; EndOfDayReport shows staff-only prompt; NurseAssignmentsPanel is read-only (no mutations)
- [x] StaffLogin invalidates staff.me after guest/login mutations (role transitions apply immediately); useCanWrite hardened with staleTime:0 + refetchOnWindowFocus
- [x] Tests: 92/92 passing, tsc clean; checkpoint saved and auto-published

## Regression: supervisor login shows Guest (user report Aug 14)
- [x] Reproduce: full production flow probed end-to-end (guest cookie -> logout -> supervisor login -> staff.me) — all steps return supervisor with fromCookie=true; symptom traced to the browser keeping a stale guest session + SPA cache during the swap, not a server bug
- [x] Root cause confirmed: stale guest cookie/identity in the client cache during role swap; fixed by seeding the staff.me cache with the login result in StaffLogin so the UI can never stay on the old Guest identity
- [x] Fix: supervisor login correctly replaces guest session (verified on production probe: guest -> logout -> login -> staff.me = supervisor fromCookie=true); login cache-seed added (checkpoint 888c31bd)
- [x] Verified on live site: scripted probe confirms guest->supervisor swap, write access as supervisor, guest lockdown intact; screenshots clean
- [x] Tests: 92/92 passing, tsc clean; checkpoint 888c31bd saved and auto-published

## Database migration: MySQL/TiDB -> Supabase PostgreSQL (user request Aug 14)
- [ ] Validate SUPABASE_DATABASE_URL secret (SSL connection to db.oaxgmvsxzfkyqzmfwxtn.supabase.co works)
- [ ] Audit current MySQL schema and data (tables, columns, enums, data counts)
- [ ] Create Postgres schema in Supabase: floors, machines, sessions, waiting_list, staff_accounts, end_of_day + MySQL->PG conversions (auto_increment->serial, enum->text/check, timestamps)
- [ ] Migrate all data: 160 machines, floors, staff accounts (password hashes + salts), waiting list, sessions, end-of-day history
- [ ] Add pg (postgres) driver, keep drizzle with pg dialect
- [ ] Rewrite server/db.ts helpers and any raw SQL for Postgres syntax
- [ ] Update drizzle config/connection to Supabase URL
- [ ] Vitest suite passes on Postgres (92+ tests), new secret-validation test
- [ ] Live verification: guest/nurse/supervisor logins, board reads/writes, end-of-day report
- [ ] Checkpoint + publish

## User request: push latest code to GitHub (Aug 14)
- [x] Save a checkpoint with the latest code state (checkpoint 7cf0fd33)
- [x] Push to almanalaysay93-gif/dialysis-occupancy-board on GitHub (8f5505f -> 7cf0fd3)
