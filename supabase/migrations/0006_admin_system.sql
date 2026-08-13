-- Admin board: admins, ban list (with auto-delist cascade), and public venue reports.
--
-- Auth model: admins sign in via Supabase Auth (email/password). The `admins` table
-- is never written to directly by clients — only the `admin-add-admin` Edge Function
-- (service role) inserts into it, after verifying the caller is already an admin. This
-- avoids the RLS bootstrap problem (an empty table can't grant itself its first member).
-- The very first admin row must be inserted manually (service role) after that person
-- creates their Supabase Auth account — see README.md.

-- ---- admins ---------------------------------------------------------------

create table public.admins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  email      text not null,
  added_by   uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Self-referential membership check — standard, non-recursive RLS pattern: any admin
-- can see the full admin list. No insert/update/delete policy exists, so direct writes
-- default-deny for everyone including admins; only the service-role Edge Function writes.
create policy "admins_can_read_admins"
  on public.admins for select
  using (exists (select 1 from public.admins a2 where a2.user_id = auth.uid()));

grant select on public.admins to authenticated;

-- ---- banned_owners ----------------------------------------------------------

create table public.banned_owners (
  id            uuid primary key default gen_random_uuid(),
  owner_key     uuid not null unique,
  owner_name    text,
  reason        text not null check (char_length(reason) between 1 and 200),
  banned_until  timestamptz, -- null = permanent
  banned_by     uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

alter table public.banned_owners enable row level security;

create policy "admins_manage_bans"
  on public.banned_owners for all
  using (exists (select 1 from public.admins where user_id = auth.uid()))
  with check (exists (select 1 from public.admins where user_id = auth.uid()));

grant select, insert, update, delete on public.banned_owners to authenticated;

-- Banning someone force-delists any venue they currently have live — runs regardless
-- of how the ban row was written, so it can't be forgotten in any one code path.
create or replace function public.cascade_ban_to_venues()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.banned_until is null or new.banned_until > now() then
    update public.venues
       set expires_at = now()
     where owner_key = new.owner_key
       and expires_at > now();
  end if;
  return new;
end;
$$;

create trigger banned_owners_cascade
  after insert or update on public.banned_owners
  for each row
  execute function public.cascade_ban_to_venues();

-- ---- reports ----------------------------------------------------------------

create table public.reports (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid references public.venues(id) on delete set null,
  venue_name     text not null, -- snapshot at report time; venue may expire/change later
  reason         text not null check (reason in (
                    'Misleading theme/info', 'Inactive/Not actually open',
                    'Inappropriate content', 'Spam/Fake listing', 'Other')),
  details        text check (details is null or char_length(details) <= 500),
  reporter_name  text check (reporter_name is null or char_length(reporter_name) <= 64),
  status         text not null default 'open' check (status in ('open', 'reviewed')),
  created_at     timestamptz not null default now()
);

alter table public.reports enable row level security;

-- Public can file a report but never read/modify reports (no visibility into who
-- reported what, and no way to tamper with existing reports).
create policy "anyone_can_file_report"
  on public.reports for insert
  with check (true);

create policy "admins_manage_reports"
  on public.reports for select
  using (exists (select 1 from public.admins where user_id = auth.uid()));

create policy "admins_update_reports"
  on public.reports for update
  using (exists (select 1 from public.admins where user_id = auth.uid()))
  with check (exists (select 1 from public.admins where user_id = auth.uid()));

grant insert on public.reports to anon;
grant select, insert, update on public.reports to authenticated;

-- ---- admin access to the full venues table -----------------------------------

-- Admins need to see every venue (active or expired) with owner_key/owner_name to
-- act on reports/bans, and to force-delist. Coexists with the anon
-- "active_venues_readable" policy from 0002 — Postgres OR's permissive policies
-- together per role, so this only ever *adds* visibility for admins, never removes
-- the public's existing (narrower) access.
create policy "admins_select_all_venues"
  on public.venues for select
  using (exists (select 1 from public.admins where user_id = auth.uid()));

create policy "admins_update_venues"
  on public.venues for update
  using (exists (select 1 from public.admins where user_id = auth.uid()))
  with check (exists (select 1 from public.admins where user_id = auth.uid()));

grant select, update on public.venues to authenticated;
