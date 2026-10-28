# Patient call delivery

Open patient and lounge screens subscribe to Supabase Realtime broadcast topic
`waiting-updates-v1`, event `changed`. The trigger sends an empty invalidation signal (Supabase may add an event ID).
It contains no ticket, patient identifier, staff name, floor, or call details.
It is only a hint to re-fetch the existing session-scoped tRPC endpoints.
Broadcast data is never trusted as a patient call.

Run `scripts/setup-live-calls.sql` on the matching Supabase database before
deploying the frontend. It installs statement triggers on `waiting_list` and
`sessions`, using `SECURITY INVOKER`. It changes no table grants or RLS policies.
Realtime must allow public channels. There are no additional server credentials.
The project's public URL/publishable key are the defaults; other environments
should set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time.
Never use a service-role key in frontend variables.

After a database write commits, the signal causes an immediate refetch. Actual
arrival depends on network and API latency. Connected clients also poll calls
every ten seconds to recover missed events. While Realtime reconnects they poll
every two seconds. Focus, network recovery, and returning to the visible page
also refresh the call state.

Patients receive voice call events only for their signed-in ticket. Lounge
screens receive calls across all boards regardless of the selected floor tab.
A patient's called status stays visible until staff cancel, remove, or admit
the waiting entry. Old calls are not re-announced to the entire lounge on reload.
Patients can replay their own current call.

## iPhone audio

The patient must tap **Enable sound**, keep the page open, keep their phone
unlocked, and turn up the volume. The tap primes browser speech and resumes Web
Audio. A call arriving before sound is enabled is still shown immediately and
can be heard after enabling sound. Muting calls mutes both speech and the chime.
The test cue uses the patient's own ticket rather than an unrelated test ticket.

This does not implement Web Push or background delivery. Safari may suspend
networking and audio when a phone is locked or another app is active. The page
refreshes on return, and the persistent notice/replay control recovers the call.
Physical iPhone testing remains necessary for each supported iOS version.
