-- Realtime carries no ticket, patient, floor, or call information. Clients
-- treat this public signal only as a hint to re-fetch the authorized API.
-- Run once on Supabase (safe to re-run). No new table grants or RLS policies.
CREATE OR REPLACE FUNCTION public.notify_waiting_display_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send('{}'::jsonb, 'changed', 'waiting-updates-v1', false);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_waiting_display_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS waiting_display_changed ON public.waiting_list;
CREATE TRIGGER waiting_display_changed
AFTER INSERT OR UPDATE OR DELETE ON public.waiting_list
FOR EACH STATEMENT EXECUTE FUNCTION public.notify_waiting_display_changed();

DROP TRIGGER IF EXISTS session_display_changed ON public.sessions;
CREATE TRIGGER session_display_changed
AFTER INSERT OR UPDATE OR DELETE ON public.sessions
FOR EACH STATEMENT EXECUTE FUNCTION public.notify_waiting_display_changed();
