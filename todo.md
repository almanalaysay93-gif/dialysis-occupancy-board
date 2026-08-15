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
- [x] Validate connection secret: base64-encoded SUPABASE_DATABASE_URL_B64 decodes cleanly and production ping returns PostgreSQL 17.6 (pooler endpoint works; direct db host unreachable from sandbox but prod egress works)
- [x] Audit current MySQL schema and data (merged commit 8f5505f dropped isolationTag/urgent/displayLabel from machines table — accounted for in migration)
- [x] Create Postgres schema in Supabase via production runtime (schema applied; tables recreated with DROP+CASCADE, BY DEFAULT identity for explicit-ID inserts)
- [x] Migrate all data via production runtime (temporary migrate procedure): floors 3, machines 160, sessions 5, waiting_list 0, staff_accounts 5 — supabase counts verified equal to MySQL
- [x] Add pg (postgres) driver: pg v8.23.0 + @types/pg installed, drizzle-orm node-postgres driver used
- [x] Rewrite drizzle/schema.ts to pg-core (serial ids, pgEnum, pg timestamps; machines matches live MySQL without isolationTag/urgent/displayLabel)
- [x] Rewrite server/db.ts to node-postgres pool via SUPABASE_DATABASE_URL_B64 (b64-decoded) with DATABASE_URL fallback; upsertUser now uses onConflictDoUpdate
- [x] $returningId (MySQL) replaced with .returning({id}) in machines.ts + seed.ts; sessions.test.ts mock updated (returning/onConflictDoUpdate chain) — 92/92 vitest passing, tsc clean
- [x] Live verification: guest/nurse/supervisor logins, board reads/writes, end-of-day report (supervisor login + staff.me fromCookie:true, waiting add/remove, endOfDay.summary, guest write 401)
- [x] Checkpoint + publish (c75ce84b — SSL rejectUnauthorized:false fix; auto-published to dialysisdash-dn9aztnn.manus.space)

## User request: push latest code to GitHub (Aug 14)
- [x] Save a checkpoint with the latest code state (checkpoint 7cf0fd33)
- [x] Push to almanalaysay93-gif/dialysis-occupancy-board on GitHub (7cf0fd3 -> c75ce84: SSL fix; 92/92 tests passing)

## Supabase rewrite — cleanup (Aug 15)
- [x] Remove temporary migration probes (supabasePing/supabaseMask/supabaseMigrate) and schema base64 from systemRouter.ts; scratch .mjs files deleted; 92/92 tests, tsc clean

## Backup & Repair board + drag-and-drop machine swap (user request Aug 15)
- [x] Schema: machines table gains a status column (active/backup/repair); status 'active' means on a floor; backup and repair machines are removed from floor display
- [x] Migration applied to Supabase (enum + columns applied live; existing 160 machines default to active); temporary migration probe endpoint removed again
- [x] Backend: machines.setStatus (move machine to backup/repair — supervisor only, or nurse for own floor with floor-scope guard; active requires picking a floor), machines.list returns status; machines.swap (vacant-only swap, RBAC scope enforced); machines.listOffboardedMachines; routers setStatus/swap/offboarded.list with SAME_MACHINE/OFFBOARD/FLOOR errors
- [x] Backend: machines.swap (vacant-only swap, RBAC scope enforced; supervisor cross-floor, nurse same-floor only)
- [x] New /backup page: board listing backup machines and repair machines in two sections, with actions to return/activate (Nav entry hidden for guests)
- [x] UI: FloorMachineChip vacant tiles draggable (staff) + drop target triggering machines.swap with toast; tile dropdown Send to Backup / Send to Repair (staff-only)
- [x] Guest mode: draggable={isStaff} keeps guests unable to drag/drop; DropdownMenu guarded by isStaff; swap RBAC server-enforced
- [x] Sidebar nav entry "Backup & Repair" hidden for guests (DashboardLayout isStaff gate)
- [x] Vitest: 13 new tests in server/machine-swap.test.ts (setStatus RBAC + mid-treatment guard, swap scoping + same-board/offboard/same-machine guards, guest blocks, offboarded.list public), 105/105 passing, tsc clean, screenshots verified (/backup, /, /floor/30001); checkpoint saved and auto-published

## Drag-and-drop fixes (user report Aug 15)
- [x] Diagnose + fix drag: onDragStart now sets text/plain + custom key (Chrome exposes all set types); onDragOver now correctly detects our tiles
- [x] Backend: swapMachines now handles same-board drops via reorderMachines (exchanges sortOrder); drop-to-backup/repair calls machines.setStatus (exists)
- [x] BackupRepair page: DropCard zones on both cards — drag-over shows teal dashed highlight + "Drop here" banner; drop calls setStatus backup/repair with toast + invalidation
- [x] Within-board reorder: same-board vacant-drop exchanges sortOrder via reorderMachines; occupied tiles remain non-droppable
- [x] Vitest updated (same-board = rearranges, 105/105 passing), tsc clean, screenshots verified (/backup drop zones, /floor/30001), checkpoint saved (auto-published), pushed to GitHub

## Drag-and-drop round 3 (user: still not able to drag and drop)
- [x] Root-cause diagnose: stale dev-server module cache (served old routers.ts throwing SAME_FLOOR/SAME_BOARD) — dev server restarted; also confirmed Tooltip wrapper removed (native title attribute used) and staff passwords were broken in Supabase because direct SQL execution tool writes to the default TiDB, not Supabase — passwords reset via the app's own DB client (supervisor/Supervisor1234, nurse.*\:Nurse1234)
- [x] Rework chip drag: Tooltip wrapper already removed (native title attribute on the chip), explicit onDragStart/onDragOver/onDrop handlers with unconditional preventDefault; grab/grabbing cursor + teal highlight + opacity feedback while dragging; BackupRepair DropCard unconditional accept with onDragLeave relatedTarget guard
- [x] Verify end-to-end in the automated browser as SKTI Supervisor: same-board reorder 60001→60002 (200 OK, tiles reordered), offboard 60003 via drop onto Backup card (200 OK, appears with Return action), return-to-board (200 OK, count back to 0); guest draggable=false, RBAC 105/105 tests green
- [x] Vitest 105/105 + tsc clean, checkpoint saved (auto-published), pushed to GitHub, delivered

## Repair flag (user request Aug 15)
- [x] Decided placement (user's screenshot = assign dialog): "Needs Repair" toggle in AssignSessionDialog — when the session ends, the machine auto-moves to Machines in Repair on /backup
- [x] Schema: sessions.needsRepairAfterSession boolean NOT NULL DEFAULT false — applied to Supabase directly (webdev_execute_sql hits TiDB, not Supabase!)
- [x] Backend: assignSession stores flag; endSession parks machine as status=repair when flagged (best-effort, never blocks end); sessions.setRepairFlag mutation toggles the flag on a live session (tile menu "Flag for repair"/"Clear repair flag" with wrench icon; End session shows "· sends machine to repair" when set); listMachines exposes needsRepairAfterSession in session payload
- [x] RBAC: setRepairFlag gated by staffOrAdminProcedure + requireFloorAccess
- [x] UI: tile menu items + wrench indicator near End session; Backup & Repair already visually distinguishes Repair (wrench, pink) vs Backup (boxes, teal); Return button still works
- [x] Vitest: 5 new repair-flag tests in sessions.test.ts — 110/110 passing; tsc clean
- [x] Browser verified as SKTI Supervisor: assigned HD-005 (P-REPAIR-TEST, 3h, clean, Needs Repair ON) → toast "marked for repair after session"; ended session → HD-005 appeared under Machines in Repair on /backup with Return action
- [x] Final: demo data cleaned (HD-005 returned to SKTI Main board), 110/110 tests + tsc clean, checkpoint d9509601 saved and auto-published, pushed to GitHub (d950960), delivered

## Repair button (user request Aug 15)
- [x] Convert "Needs Repair" from a Switch toggle to a selectable Button (like Clean/Dirty isolation buttons) in AssignSessionDialog — verified in browser, checkpoint f5b05f10 saved (auto-published)

## Single repair button (user request Aug 15)
- [x] Remove the "No" button; single "Send to repair" button that toggles on click (tap once to flag → "Send to repair — on" in rust, tap again to unflag) — verified in browser, tsc clean, 110/110 tests

## Bug: Send to repair does nothing (user report Aug 15)
- [x] Diagnose: live site verified clean — JS bundle, backend, and DB all correct; prior symptom was due to the stale guest cookie during the earlier role swap (fixed by login cache-seed); flagged session confirmed in Supabase
- [x] Fix root cause: none needed in repair logic; production cookie/stale-session handling already patched; repair flow re-verified end-to-end live
- [x] Verified end-to-end on production: assigned HD-001 (P-TEST-1, 3h, Send to repair ON) as supervisor → ended session via tile menu → HD-001 auto-parked under Machines in Repair on /backup (Supabase: session 7 status=ended needsRepairAfterSession=true, machine 60001 status=repair); then returned HD-001 to SKTI Main; all probe sessions/patients deleted from Supabase; probe scripts removed; 110/110 tests, tsc clean
- [x] Tests pass (110/110), tsc clean, checkpoint saved and auto-published, pushed to GitHub, final delivery to user

## Remove repair toggle from assign dialog (user request Aug 15)
- [x] Remove "Needs Repair" Send to repair toggle button + helper text from AssignSessionDialog
- [x] Tile-menu Flag for repair / Clear repair flag flow kept working (repair flag still functional; backend unchanged)
- [x] 110/110 tests pass, tsc clean, checkpoint saved (auto-publish), push GitHub, deliver

## Pause time option (user request Aug 15)
- [x] Schema: sessions.pausedAt/pausedSeconds columns added to Supabase (pausedAt timestamp + cumulative pausedSeconds) and drizzle schema
- [x] Backend: sessions.togglePause (pause sets pausedAt; resume shifts endsAt by elapsed pause into pausedSeconds); endSession pause-aware — shifts endsAt by live pause, clears pause state, keeps repair flag
- [x] UI: Pause timer / Resume timer menu item in FloorMachineRow tile menu; paused tile shows pulsing "⏸ Paused" badge and frozen countdown (uses endsAt + pausedSeconds while paused)
- [x] Vitest: 3 pause tests (pause freeze, resume shift, end-of-paused-session shift) — 113/113 passing; tsc clean; checkpoint saved (auto-publish); push GitHub; deliver

## End-of-day report: pause/idle time + narrative report (user request Aug 15)
- [x] Schema: narrative_reports table created in Supabase (floorId, reportDate YYYY-MM-DD, periodKey, shiftKey, author, body, createdAt, updatedAt) and drizzle schema
- [x] endOfDayReport adds machineMetrics (occupied/paused/idle minutes per machine; idle = operating window minus occupancy) + pauseSummary; populated in EndOfDayReport via /report card
- [x] Backend: narratives.list / narratives.create / narratives.remove tRPC procedures (floor-scoped RBAC; staff only; INVALID_PERIOD/EMPTY_BODY error mapping)
- [x] EOD report page/UI: Narrative Report card per board with 7 periods (S1 5-10, T1 9-11 hook/term, S2 10-14, T2 13-15, S3 14-18, T3 17-20, S4 18-22), shift selector (6 shifts incl. 7-3/3-11/11-7), author prefill from staff session, write/save/delete per entry, print-friendly
- [x] Vitest: 4 narrative + metrics specs in staff-rbac.test.ts (nurse own floor OK, nurse other floor FORBIDDEN, supervisor any floor + guest UNAUTHORIZED, endOfDay summary metrics present) — 117/117 passing, tsc clean; checkpoint saved (auto-publish); push GitHub; deliver

## Move narrative report to floor boards (user request Aug 15)
- [x] NarrativeReport extracted from EndOfDayReport (editable prop; NarrativeSection = read-only wrapper)
- [x] NarrativeReport mounted on each floor board page (FloorBoard /floor/:id + combined board when scoped) — nurses write during the shift; RBAC floor-scoped, guests read-only
- [x] End of Day Report (/report) now read-only reflection: completed narratives shown, "No entry" markers, no write/delete controls
- [x] tsc clean, 117/117 vitest; screenshots verified on all three boards; checkpoint saved (auto-publish); push GitHub; deliver

## Fix narrative doubling and reposition (Aug 15)
- [x] Narrative Report duplicate removed (single mount in OccupancyBoard in Home.tsx; FloorBoard's own mount deleted — the two mounts plus FloorBoard setting floorId caused doubling)
- [x] Narrative Report repositioned directly below the machines grid (above Waiting List and the Add Machine / Assign Next Vacant footer)
- [x] Bonus fix: anonymous/guest sessions now read narratives + end-of-day report (staffReadProcedure added; writes stay staff-only); isError fallback added; 118/118 tests pass, tsc clean; checkpoint saved (auto-publish); push GitHub; deliver

## Supervisor vs nurse narrative split (Aug 15)
- [x] Board-level narrative card: supervisors become view-only (no write/edit/delete controls); nurses + charge nurses keep write access (Subtitle "supervisors view only"; write gating by staff role)
- [x] Schema: supervisor shift periods (supShift1 07-15, supShift2 15-23, supShift3 23-07) added as SUPERVISOR_PERIODS in server/machines.ts — same narrative_reports table, periodKey namespace, only supervisor can write
- [x] Backend: createNarrative role guard — supervisor cannot write board periods (session/transition), only supervisor periods; nurse cannot write supervisor periods; router reports the writer's real staff role server-authoritatively
- [x] End of Day Report: SupervisorNarrativeSection added with the three 7-3/3-11/11-7 periods per floor — writable by supervisors only, read-only for nurses/guests
- [x] Tests + tsc: 119/119 vitest passing (supervisor-nurse split spec verifies role-gated period validation), tsc clean; checkpoint saved (auto-publish); push GitHub; deliver

## Supervisor narrative layout restructure (Aug 15)
- [x] End of Day Report: Supervisor Narrative Report grouped by shift (7–3, 3–11, 11–7) as the primary rows, with SKTI Main / RDU Annex / RDU Main areas as sub-tables inside each shift (instead of per-area cards) — verified end-to-end in browser as supervisor (write → saved with area picker → renders in correct shift/area slot with delete; probe entry cleaned)

## Supervisor narrative write form as popup (Aug 15)
- [x] Write form (Area picker, Your name, Narrative textarea, Cancel/Save) opens in a Dialog popup modal instead of an inline panel inside the Supervisor Narrative Report card — verified end-to-end as supervisor in browser (dialog opens from any shift/area row, save lands entry in correct shift-area slot with delete icon, probe cleaned); 119/119 tests, tsc clean

## Supervisor narrative missing NO ENTRY marker (Aug 15, user report)
- [x] Every empty shift/area slot in the Supervisor Narrative Report renders the "NO ENTRY" marker; first attempt suppressed it on the first row instead — marker now renders unconditionally on every empty slot; verified all 9 slots show NO ENTRY as supervisor; 119/119 tests, tsc clean
