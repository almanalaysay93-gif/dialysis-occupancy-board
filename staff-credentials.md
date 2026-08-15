# Staff Login Credentials — Hemodialysis Occupancy Board

These are the local board staff accounts used at **[dialysisdash-dn9aztnn.manus.space](https://dialysisdash-dn9aztnn.manus.space)**. Log in at the **Staff Login** page (`/staff-login`) or via the **"Sign in as staff"** link in the top-right corner of the board.

| Username | Password | Role | Access |
|---|---|---|---|
| `supervisor` | `Supervisor1234` | SKTI Supervisor | All three boards (SKTI Main, RDU Annex, RDU Main), room management, and the End of Day report for every board |
| `nurse.skti-main` | `Nurse1234` | SKTI Nurse | SKTI Main board only (machines, waiting list, nurse assignments, its own End of Day report) |
| `nurse.rdu-annex` | `Nurse1234` | RDU Nurse | RDU Annex board only |
| `nurse.rdu-main` | `Nurse1234` | RDU Nurse | RDU Main board only |
| `auditor` | `Auditor1234` | Auditor | Read-only view of all boards and the End of Day report; the only account that can see the **Narrative Edit History** audit trail on the `/report` page. Cannot write, edit, or delete anything. |
| *(no login needed)* | — | Guest | Tap **Continue as Guest** on the staff login page. View-only on all boards; write actions and room management are hidden |

> **Recommendation:** change these passwords after first use. Each account is created through the system, and passwords are stored as salted SHA-256 hashes, so they cannot be read back from the database. Ask me to update any account's password, rename it, or create additional nurse accounts for other floors.

## Narrative edit history (audit trail)

Every time a narrative entry is written, changed, or deleted (board-level charge-nurse narratives and supervisor shift narratives), the system records a history row with the time, area, period, the type of change (create / update / delete), who made it (their staff identity), and a snapshot of the content — including the text that existed **before** the change. Log in as the auditor account and open the **End of Day Report** page (`/report`); the **Narrative Edit History** card appears at the bottom, visible only to the auditor. This provides accountability: anyone reviewing the day can see exactly who changed what narrative and when.

## Notes

- The owner/admin sign-in (top-right on the board) uses the separate Google OAuth login and keeps full administrative access regardless of the staff logins above.
- Nurses are floor-scoped on the server: a nurse can only start/end sessions, edit labels, or manage the waiting list on their assigned floor, even if they try to call the API directly.
- The End of Day report at `/report` automatically shows only the nurse's own board, while the supervisor sees all three boards.
- **Supervisor/nurse login persistence (fixed):** staff sessions are now stored in a secure, persistent cookie and survive page reloads and separate visits on the live site. If a login still appears as "Guest" after a reload, try logging in again once — and changing the password to something longer is a good idea.
