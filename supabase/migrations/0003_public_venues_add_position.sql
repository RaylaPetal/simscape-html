-- public_venues (0002) omitted local_x/y/z, but the Browser HUD needs them to
-- build a teleport destination for llMapDestination without a second HTTP round
-- trip. Add them back in — still no owner_key/object_key/secret_token_hash exposed.

-- New columns must be appended, not inserted — CREATE OR REPLACE VIEW can't
-- reorder existing columns (Postgres error 42P16).
create or replace view public.public_venues
  with (security_invoker = false) as
select id, name, theme, population, region_name, slurl, published_at, expires_at,
       local_x, local_y, local_z
from public.venues
where expires_at > now();

grant select on public.public_venues to anon;
