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

## Draft auto-save + edit history + auditor account (Aug 15)
- [x] Draft auto-save (localStorage) on supervisor narrative dialog: restore previous text on open, save on change, clear after successful save
- [x] Draft auto-save on board-level (charge nurse) narrative writer form
- [x] narrative_history audit table (narrative id, floor, date, period, action create/update/delete, actor, body snapshot, timestamp)
- [x] Backend: narratives.create/update/delete append to history; narratives.history procedure readable only by auditor role (procedure switched from protectedProcedure to staffReadProcedure after discovery that auditor lacks an OAuth session); staffReadProcedure + staffAccessedFloors updated so auditor resolves as a valid read staff role
- [x] Staff role enum: add 'auditor' to staff_accounts role; auditor read-only access to reports; auditor cannot write narratives
- [x] Seed auditor account (auditor/Auditor1234) via same seeding path as other staff
- [x] Edit History viewer on /report page visible only when staff role === auditor; shows per-narrative change log — verified end-to-end: nurse created a narrative on SKTI Main Session 1, updated it, auditor saw both CREATE and UPDATE rows in the Narrative Edit History table (time/area/period/change/made-by/content columns); test data cleaned from Supabase after verification
- [x] Tests + tsc: 119/119 vitest passing, tsc clean; checkpoint saved (auto-publish); push GitHub; deliver

## Remove machine option (user request Aug 15)
- [x] Backend: machines.remove procedure (RBAC: supervisor/auditor any machine; nurse own floor only via requireFloorAccess; guest UNAUTHORIZED) with safety guards: refuse if machine has an active session (MACHINE_IN_TREATMENT → CONFLICT), refuse if status backup/repair (MACHINE_OFFBOARD → CONFLICT, must return to active floor first), MACHINE_NOT_FOUND → NOT_FOUND
- [x] UI: Remove Machine action on vacant machine tile menu — staff only, destructive confirmation dialog (RemoveMachineDialog.tsx) explaining in-treatment/backup-repair restrictions; in-treatment tiles keep the end-session path
- [x] Vitest coverage: remove guards tests in machine-swap.test.ts (supervisor remove, backup reject, in-treatment reject, not-found, guest blocked); nurse cross-floor scoping covered in staff-rbac.test.ts "machine removal scoping"; 124/124 passing, tsc clean; live end-to-end verified on Supabase (removed HD-012 on SKTI Main, confirmed deletion, restored to keep 100 machines); checkpoint saved (auto-publish); push GitHub; deliver

## SKTI ICU floor naming bug (user report Aug 15)
- [x] Newly added "SKTI ICU" floor displays as "SKTI Main" on its board page — root cause: auto-assigned id 1 collided with the sort-order fallback in FloorBoard's route resolver (raw '1' matched SKTI Main's sortOrder 1 first); fixed resolver to match floor code/id first and only fall back to sortOrder when no id matches
- [x] Verify other floors unaffected (/floor/30001, /floor/30002 correct), tests + tsc (124/124 passing), checkpoint, push GitHub, deliver

## Duplicate header on floor board page (user report Aug 15)
- [x] /floor/:id showed two stacked headers: FloorBoard's own "LIVE BOARD" masthead rendered inside the dashboard shell; fixed canonically — /floor/:id route wrapped in DashboardLayout in App.tsx and FloorBoard's masthead header removed, so the shell header is the single header on every floor board (SKTI ICU, SKTI Service Ward included)
- [x] Verified /floor/1, /floor/30001, /floor/30002 and Home render with one header (screenshots); 124/124 tests passing, tsc clean; checkpoint saved (auto-publish); push GitHub; deliver

## Add machine reports success but no machine appears (user report Aug 15)
- [x] Reproduce: root cause found — AddMachineDialog's floorId state started at "none" and never initialized from initialFloorId/first floor; submitting without touching the Floor select inserted the machine with floorId NULL, invisible on scoped /floor/:id boards (grouped under "Unassigned" which is excluded)
- [x] Fix: useEffect in AddMachineDialog initializes floorId to the dialog's initial floor (or the first floor) when it opens; the user's two test machines (098, 099, created with null floorId on Aug 15) were re-assigned to SKTI ICU in the live Supabase DB
- [x] Verify end-to-end: /floor/1 shows machines 098/099 on the SKTI ICU board; /floor/30001 (SKTI Main, 94 machines), /floor/30002 (RDU Annex, 36), /floor/30003 (RDU Main, 24) all resolve with correct names and single header; tests 124/124 passing, tsc clean

## User-reported 10-bug pass (Aug 15)

### Critical
- [x] Fix `.returning({ id: machines.id })` copy-paste crash in machines.ts — the sessions.insert, waiting.insert, and floors.insert calls in machines.ts now return their own table ids (`sessions.id` / `waiting_list.id` / `floors.id`); all three workflows (assign session, add waiting, add room) now return a usable id
- [x] Fix race condition on concurrent session assignments — assignSession and admitWaiting now run the vacancy lookup and session insert inside a DB transaction with FOR UPDATE row locking and a post-lock re-check; a concurrent second assignment is rejected with CONFLICT instead of double-booking; mock db.transaction/.for added to sessions.test.ts

### High
- [x] Add confirmation dialog to End Session — occupied tile menu now opens the existing EndSessionDialog (confirm before terminating); raw mutation removed from FloorMachineRow
- [x] Sidebar highlights wrong floor (active state) — sidebar active state now matches the floor by id on /floor/:id instead of always highlighting the first floor item
- [x] Sidebar toggle button does nothing — PanelLeft button now calls the sidebar state's toggle instead of being a no-op
- [x] Edit title (rename session label) erases existing text — RenameSessionLabelDialog hydrates its input from the current label when opening, and AssignSessionDialog's inline title editor keeps the existing label instead of clearing it

### Medium
- [x] Silent narrative mutation failures — all narrative mutations (board session/transition narratives, supervisor shift summaries, supervisor dialog) now have onSuccess/onError toasts and invalidate on success
- [x] Unmapped error codes leaking as 500 — new server/errors.ts mapBackendError maps known backend error codes (MACHINE_OCCUPIED, DURATION_OUT_OF_RANGE, etc.) to typed tRPC errors; passes existing TRPCError through untouched; all catches (waiting.add/remove, setPriority, sessions.end/toggleUrgent/setRepairFlag/updateTag, machines.add, narratives.update/remove) route through it
- [x] Race conditions on concurrent session assignments (covered by the transaction/locking fix above)

## New nurse accounts for SKTI ICU and SKTI Service Ward (user request, Aug 16)
- [x] Inspect how existing nurse accounts are seeded and how floor access is mapped (staff_accounts, assignedFloorId, credentials files)
- [x] Create nurse.skti-icu account scoped to the SKTI ICU floor (floor id 1) with password Seed@1234
- [x] Create nurse.skti-service-ward account scoped to the SKTI Service Ward floor (floor id 2) with password Seed@1234
- [x] Verify RBAC live: both nurses log in successfully (staff.me role=nurse, fromCookie=true), and write attempts on other boards (RDU Annex 30002) are blocked; floor-scoped same as other nurses
- [x] Update staff-credentials.md with the two new accounts and supervisor/End-of-Day references to five boards
- [x] Update seed.ts (F4/F5 boards, both new nurse entries) so re-seeds stay in sync
- [x] Checkpoint, push to GitHub, deliver

## PDF export for the End of Month report (user request, Aug 16)
- [x] Inspect EndOfDayReport page: current structure, monthly data availability, and where the export button should live
- [x] Backend monthReport helper + endOfDay.monthly procedure: per-day sessions/patients/machines/utilization/urgency/isolation/waiting/treatment hours + totalPausedMinutes, plus monthly totals
- [x] UI: month picker (defaults to current month) on /report; "Export Month PDF" button (crimson) opens the browser print dialog
- [x] PrintableMonthReport component: print-only (screen:hidden/print:block) with cover header, per-floor summary tables, day-by-day table; A4 @page; app chrome hidden in print
- [x] Month-only print mode: "Export Month PDF" hides the daily report via a print:screen-only wrapper so the PDF contains only the End of Month report (plain Print still exports the daily report)
- [x] Performance fix during verification: replaced the per-day machineDayMetrics N+1 loop (~87 s) with a bulk machineRangeMetrics computation (~5 s)
- [x] Verify end-to-end: supervisor sees month picker + button, monthly data loads, print CSS correct; 128/128 tests pass, tsc clean; checkpoint, push GitHub, deliver

## Glassmorphism theme + imagery (user request, Aug 16 — /buildme)
- [x] Upload building image (images.jpg) and HD machines image to webdev static storage and get URLs
- [x] Add global glassmorphism utilities to index.css (.glass-panel, .glass-deep, .glass-table, .glass-icon, .glass-photo) consistent with SKTI palette
- [x] Convert report tables/cards/panels (ReportBoardCard, NarrativeReport, supervisor narrative, edit history, all 4 report tables, error/empty cards) and panels (auth-gate boxes on Home/Rooms/Urgent, Nurse Assignments section) to glassmorphism style (machine tile status colors preserved)
- [x] Integrate building image into site identity: frosted backdrop of the institute banner on every board (Home.tsx) and the hero card on the staff login page, with the SKTI seal in a glass disc
- [x] Integrate HD machines image as a glass-framed vignette on the board banner and the login hero
- [x] Verify visuals (6-page screenshots), 128/128 tests + tsc pass, checkpoint saved (auto-publish)

## Login page refinement (user request, Aug 16 — /buildme)
- [x] Enlarge the SKTI seal/logo on the staff login hero card (24-unit glass disc)
- [x] Remove blank space: tightened spacing on the login hero
- [x] Remove the HD machines photo from the login hero
- [x] Remove the HD machines photo from the board banner
- [x] Verify visuals (screenshots), checkpoint saved (auto-published)

## Hero blank space + glassmorphism visibility fix (Aug 16 — /buildme)
- [x] Login hero: eliminated white blank space — building photo now fills the card edge-to-edge (object-cover, opacity 0.4 with light top/bottom tints)
- [x] Strengthened glassmorphism utilities — .glass-panel/.glass-deep/.glass-table: deeper frost opacity, stronger blur/saturation, brighter borders + top highlight + subtle outer ring
- [x] Banner strip shows visible frosted glass over a richer building backdrop (opacity 0.35, gradient overlay reduced)
- [x] Verified on production after hard reload: seal renders in banner, glass visible; checkpoint 02be6cf8 (auto-published); verified seal JPEG content is intact (800x800, real colors)
- [x] Push latest changes to GitHub (02be6cf)

## Logo ring removal (Aug 16 — /buildme)
- [x] Removed the frosted disc ring around the seal on the login hero (larger seal directly on the backdrop with soft drop shadow)
- [x] Removed the frosted disc ring around the seal in the board banner
- [x] Other logo usages (sidebar + header in DashboardLayout) checked — no glass disc ring there (solid backgrounds), unchanged
- [x] Verified visually (screenshots), 128/128 tests + tsc clean, checkpoint + push pending
- [x] White circle border removed at the image level: extracted the seal from the JPEG's white background via edge-connected flood fill, produced a transparent PNG (skti-seal-transparent_b9fdeed9.png), uploaded to webdev storage, and swapped the reference in Home.tsx, StaffLogin.tsx, and DashboardLayout.tsx

## Supervisor-only monthly PDF export (Aug 16)
- [x] Backend: new supervisorProcedure in server/_core/trpc.ts; endOfDay.monthly switched from staffReadProcedure to supervisorProcedure (nurses/auditors/guests rejected with FORBIDDEN; OAuth admins allowed)
- [x] UI: month picker and Export Month PDF button hidden from non-supervisors on /report; the monthly query is disabled (enabled: false) for them so the endpoint is never called
- [x] Vitest: replaced stale nurse-scoping monthly tests with nurse/auditor/guest FORBIDDEN tests verifying monthReport DB call never happens; 130/130 passing, tsc clean
- [x] Verified as guest on /report (screenshot): no month controls, staff-only prompt shown; checkpoint ee3e103c saved (auto-published)
- [x] Push latest changes to GitHub (a677b5d)

## Guest visibility gates (Aug 16)
- [x] Home.tsx: Waiting List, Nurse Assignments, and Narrative Report panels gated behind !isGuest in OccupancyBoardContent (covers / and /floor/:id)
- [x] DashboardLayout.tsx: /urgent removed from the guest sidebar
- [x] Urgent.tsx: guest view replaced with "reserved for clinical staff" prompt + staff-login link; urgent query disabled for guests
- [x] Verified live in browser as guest: /floor/30001 shows machines with no Waiting/Nurse/Narrative panels; /urgent shows the staff-only prompt and no Urgent Cases entry in the sidebar; 130/130 tests pass, tsc clean
- [x] Checkpoint 4666928e saved (auto-published); pushed to GitHub (4666928)

## Sidebar brand text truncation (Aug 16)
- [x] Fixed "SPMC KIDNEY & TRANS..." truncation: removed truncate from sidebar brand subline, added whitespace-normal break-words — the name now wraps to two lines (verified in screenshots)
- [x] Checked other truncated spots (header bar / user block): no brand truncation found there
- [x] Verified sidebar full brand text (screenshots), 130/130 tests pass, tsc clean; checkpoint 08e16cd7 (auto-published); push pending

## Full institute name in brand (Aug 16)
- [x] Sidebar brand subline changed to "SPMC Kidney & Transplant Institute" (wraps to two lines, no truncation — verified in screenshot)
- [x] Checked other brand spots (header bar user block, login page, banner, printable report): they already carry the full institute name — no changes needed
- [x] Checkpoint 246675ff saved (auto-published); push pending

## Month print excludes daily report (Aug 16)
- [x] Ensure "Export Month PDF" print output contains only the End of Month report — the daily End of Day Report must not print in the same PDF
- [x] Verify print output (print CSS / print-mode toggle works in month-only mode), checkpoint c90aafd3 saved, 130/130 tests pass; push pending

## Cinematic footer animation (user request Aug 16)
- [x] Install GSAP + ScrollTrigger (client-only, dynamic import via ensureGSAP(); GSAP registered once with ScrollTrigger and React context cleanup)
- [x] Build adapted CinematicFooter component: theme-adaptive glass pills (.footer-glass-pill using shadcn oklch tokens), heartbeat pulse on the ❤ badge, breathing aurora backdrop, grid backdrop, scroll-reveal parallax (giant SPMCKTI background text + staggered content reveal), tilted 40s marquee strip
- [x] Marquee content adapted to the dialysis board: Real-Time Machine Tracking / Urgent Case Response / Clean-Dirty Isolation / Nurse Floor Assignments / Daily & Monthly Reporting; CTAs point to Occupancy Board, Rooms & Floors, Staff Sign In, End of Day Report, Backup & Repair; "Crafted with ❤ for SPMCKTI" badge
- [x] Mount footer below the board content in Home.tsx (inside DashboardLayout); GSAP registration is scroll-safe and print-safe
- [x] Verify visuals: desktop + mobile screenshots, browser scroll check showing heading, pills, heartbeat badge, back-to-top, giant background text, marquee; tsc clean, 130/130 tests pass; checkpoint + push + deliver

## Footer badge credit (user request Aug 16)
- [x] Replace "Crafted with ❤ for SPMCKTI" badge with "Developed by AL John P. Manalaysay RN" in CinematicFooter bottom bar
