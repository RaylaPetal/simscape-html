-- Lock down public.venues entirely: anon/authenticated get no grants on it at all,
-- so sensitive columns (secret_token_hash, owner_key, object_key) are never readable
-- by the public site/HUD. All writes happen only via Edge Functions using the
-- service-role key, which bypasses RLS.

alter table public.venues enable row level security;

-- Defense-in-depth: even if grants are ever loosened, row visibility stays gated
-- to non-expired venues. There are intentionally no insert/update/delete policies,
-- so those default-deny for anon/authenticated.
create policy "active_venues_readable"
  on public.venues for select
  using (expires_at > now());

revoke all on public.venues from anon, authenticated;

-- Public-facing view: only the columns the site/HUD need, already filtered to
-- currently-active venues. This is what auto-delist-on-expiry actually is —
-- expired rows simply stop being selectable, no cleanup job required.
create view public.public_venues
  with (security_invoker = false) as
select id, name, theme, population, region_name, slurl, published_at, expires_at
from public.venues
where expires_at > now();

grant select on public.public_venues to anon;
