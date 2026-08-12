# ShowSims

Second Life venue-listing platform: a showbuzz.org-style website listing currently open
venues (name, population, theme), fed by two in-world LSL objects. See `Project Plan.MD`
for the original requirements and `.claude/plans/` (if present) for the full design.

## How it fits together

- **Supabase** (Postgres + PostgREST + Edge Functions) is the entire backend — no VPS.
  - Writes (publish a venue, heartbeat population) go through Edge Functions using the
    service-role key server-side.
  - Reads (the venue list) go straight to PostgREST with the public anon key, filtered by
    Row Level Security / the `public_venues` view to only currently-active venues.
  - A venue "expires" simply by falling out of that `expires_at > now()` filter — no
    cleanup job needed.
- **GitHub Pages** serves the static site from `/docs` — no build step.
- **Two LSL scripts** (`/lsl`) talk to Supabase via `llHTTPRequest`.

## Setup

### 1. Supabase project

1. Create a project at supabase.com. Note its Project URL and anon key
   (Project Settings → API) and its `project ref`.
2. Install the Supabase CLI, then from this repo:
   ```
   supabase link --project-ref ingqyyxryrfunxgedypt
   supabase db push                     # applies supabase/migrations/*.sql
   supabase functions deploy publish
   supabase functions deploy heartbeat
   supabase functions deploy delist     # optional
   ```
   `supabase/config.toml` already sets `verify_jwt = false` for these three functions,
   since LSL objects aren't OAuth clients — each function validates its own input instead.
3. (Optional, for Stage 3 testing) Run `supabase/seed.sql` in the SQL editor to get a few
   sample venues, including one already-expired, before any LSL objects exist.

### 2. Static site

Edit `docs/config.js` with your project's `SUPABASE_URL` and anon key (the anon key is
meant to be public — it's what RLS/the view are for). Enable GitHub Pages on this repo,
source = `main` branch, folder = `/docs`.

### 3. LSL scripts

In both `lsl/owner_publish_object/owner_publish_object.lsl` and
`lsl/browser_hud/browser_hud.lsl`, fill in the URL/key constants at the top of the file
with your project's values, then:

- Rez `owner_publish_object.lsl` (in an object) on the parcel you want to list. Touch it
  as the parcel/object owner to publish; touching it as anyone else shows read-only status.
  Optionally drop a full-permission texture named exactly `Venue Photo` into the object's
  inventory (an in-world Snapshot to Inventory works, most marketplace textures won't —
  see `lsl/shared_reference/themes.md`) to show a cover photo on the site.
- Attach `browser_hud.lsl` (in a HUD object) and touch it to browse/filter/teleport.

`lsl/shared_reference/themes.md` is the single source of truth for the theme list and
duration options — if you change them, update it and everywhere it points to.

## Verification order

Recommended order (see the plan for full detail): (1) schema + RLS via `curl`/SQL editor
only, (2) Edge Functions via `curl` with LSL-shaped payloads, (3) static site against
seeded data, (4) the Owner Publish Object in-world, (5) the Browser HUD against live data,
(6) a full real 6h/24h soak test.

## Explicitly out of scope for now

Permanent listings / subscription tier, an owner web dashboard, venue thumbnail images,
stale-heartbeat safety delisting, and abuse throttling on `publish` — see `Project Plan.MD`
("Never permanent yet, that will be added later as a subscription").


Supabase PW: FhHbCazn3nbh5EY5