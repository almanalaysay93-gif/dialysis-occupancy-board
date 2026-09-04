# Staff Login Credentials - Hemodialysis Occupancy Board

These are the local board staff accounts used at **[dialysis-occupancy-board.vercel.app](https://dialysis-occupancy-board.vercel.app)**.
Log in at the **Staff Login** page (`/staff-login`) or via the **"Sign in as staff"** link in the top-right corner of the board.

| Username | Password | Role | Access Scope |
|---|---|---|---|
| `supervisor` | `Supervisor1234` | SKTI Supervisor | All five boards (SKTI Main, RDU Annex, RDU Main, SKTI ICU, SKTI Service Ward), room management, and End of Day reports |
| `nurse.skti-main` | `Nurse1234` | SKTI Nurse | SKTI Main board only (machines, waiting list, nurse assignments, its own End of Day report) |
| `nurse.rdu-annex` | `Nurse1234` | RDU Nurse | RDU Annex board only |
| `nurse.rdu-main` | `Nurse1234` | RDU Nurse | RDU Main board only |
| `nurse.skti-icu` | `Seed@1234` | SKTI Nurse | SKTI ICU board only |
| `nurse.skti-service-ward` | `Seed@1234` | SKTI Nurse | SKTI Service Ward board only |
| `auditor` | `Auditor1234` | Auditor | Read-only view of all boards and the End of Day report; access to the **Narrative Edit History** audit trail on the `/report` page |
| `guest` | *(no password)* | Guest | Tap **Enter as Guest** on the staff login page. Read-only occupancy on all boards |

> **Recommendation:** change these passwords after first use.
Each account is created through the system, and passwords are stored as salted SHA-256 hashes, so they cannot be read back from the database.

## Narrative edit history (audit trail)

Every time a narrative entry is written, changed, or deleted (board-level charge-nurse narratives and supervisor shift narratives), the system records a history row with the time, area, period, the type of change (create / update / delete), who made it (their staff identity), and a snapshot of the content (including the text that existed **before** the change).
Log in as the auditor account and open the **End of Day Report** page (`/report`).
The **Narrative Edit History** card appears at the bottom, visible only to the auditor.
This provides accountability: anyone reviewing the day can see exactly who changed what narrative and when.

## Notes

- The owner/admin sign-in (top-right on the board) uses the separate Google OAuth login and keeps full administrative access regardless of the staff logins above.
- Nurses are floor-scoped on the server: a nurse can only start/end sessions, edit labels, or manage the waiting list on their assigned floor, even if they try to call the API directly.
- The End of Day report at `/report` automatically shows only the nurse's own board, while the supervisor sees all five boards.
- **Supervisor/nurse login persistence (fixed):** staff sessions are now stored in a secure, persistent cookie and survive page reloads and separate visits on the live site.
If a login still appears as "Guest" after a reload, try logging in again once.
Changing the password to something longer is a good idea.
