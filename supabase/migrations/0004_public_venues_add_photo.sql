-- Venue cover photo: LSL has no way to read a parcel's About Land snapshot, so
-- the owner instead drops a texture named "Venue Photo" into the Publish
-- Object's inventory. The object sends that texture's UUID at publish time;
-- the site renders it via Linden Lab's public texture proxy
-- (https://secondlife.com/app/image/<uuid>/large).

alter table public.venues add column photo_texture_uuid uuid;

-- Appended at the end — CREATE OR REPLACE VIEW can't reorder existing columns
-- (Postgres error 42P16), only add new ones after the existing list.
create or replace view public.public_venues
  with (security_invoker = false) as
select id, name, theme, population, region_name, slurl, published_at, expires_at,
       local_x, local_y, local_z, photo_texture_uuid
from public.venues
where expires_at > now();

grant select on public.public_venues to anon;
