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
