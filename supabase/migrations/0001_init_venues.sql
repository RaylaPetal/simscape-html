-- Simscape: core venues table.
-- object_key is the identity of the in-world owner "publish" object (llGetKey()),
-- used as the upsert key so re-publishing the same object updates the same row.

create extension if not exists pgcrypto;

create table public.venues (
  id                uuid primary key default gen_random_uuid(),
  object_key        uuid not null unique,
  name              text not null check (char_length(name) between 1 and 64),
  theme             text not null check (theme in (
                       'BDSM','Club','Venue','Hangout','Dating',
                       'Roleplay','Live Music','Shopping','Other')),
  population        integer not null default 0 check (population >= 0),
  region_name       text not null,
  local_x           real not null,
  local_y           real not null,
  local_z           real not null,
  slurl             text not null,
  owner_key         uuid not null,
  owner_name        text,
  secret_token_hash text not null,
  duration_hours    smallint not null check (duration_hours in (6, 24)),
  published_at      timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index venues_expires_at_idx on public.venues (expires_at);

-- Keep updated_at current on any row change.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger venues_set_updated_at
  before update on public.venues
  for each row
  execute function public.set_updated_at();
