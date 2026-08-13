-- Owner Publish Object now offers 2/4/6/12/24 hour options (was 6/24 only).
-- Keep in sync with supabase/functions/_shared/venues.ts (DURATION_HOURS) and
-- lsl/owner_publish_object/owner_publish_object.lsl (DURATION_BUTTONS/DURATION_HOURS).

alter table public.venues drop constraint venues_duration_hours_check;

alter table public.venues add constraint venues_duration_hours_check
  check (duration_hours in (2, 4, 6, 12, 24));
