# Shared constants — keep in sync

LSL has no `#include`/shared-module mechanism, so these values are duplicated by hand
across several files. If you change any of them, update **all** of the following:

- `supabase/migrations/0001_init_venues.sql` — `theme` CHECK constraint, `duration_hours` CHECK constraint
- `supabase/functions/_shared/venues.ts` — `THEMES`, `DURATION_HOURS`
- `lsl/owner_publish_object/owner_publish_object.lsl` — `THEME_BUTTONS`
- `docs/styles.css` — `[data-theme="..."]` badge color rules
- `docs/app.js` — `THEMES` (filter chips)

The Browser HUD (`lsl/browser_hud/browser_hud.lsl`) does **not** filter by a specific
theme value — its "Filters" menu only picks a *sort order* (Population/Name/Theme,
mirroring `docs/app.js`'s `SORTERS`), so it has no theme list to keep in sync.

## Themes

```
BDSM
Club
Venue
Hangout
Dating
Roleplay
Live Music
Shopping
Other
```

LSL `llDialog` allows at most 12 buttons per dialog and each button label is capped at
24 UTF-8 bytes. All 9 theme names above are short enough to fit directly as button
labels with room to spare for a "Back"/"Cancel" button alongside them (9 themes + 1
control button = 10, under the 12 limit).

## Durations

```
2 hours
4 hours
6 hours
12 hours
24 hours
```

Enforced by the `venues_duration_hours_check` CHECK constraint
(`supabase/migrations/0005_expand_duration_hours.sql`) and `DURATION_HOURS` in
`supabase/functions/_shared/venues.ts` — the `publish` function rejects (422
`invalid_duration_hours`) anything not in this list, so this list, the DB constraint, and
`DURATION_BUTTONS`/`DURATION_HOURS` in `owner_publish_object.lsl` must always match.

No "permanent" option — see Project Plan.MD ("Never permanent yet, that will be added
later as a subscription"). Heartbeat calls must never extend `expires_at`; only a fresh
`publish` call sets a new expiry.

## Heartbeat interval

`300` seconds (5 minutes), used by the Owner Publish Object's `llSetTimerEvent`.

## Who can touch the Owner Publish Object

Only the land parcel's owner may open the publish/manage dialogs (`isParcelOwner()` in
`owner_publish_object.lsl`) — everyone else gets a read-only status dialog.

**If the parcel is deeded to a group**, there's a required one-time setup step: LSL has
no way to check arbitrary group membership, so set this object's own **Group** (in-world:
select the object → Edit → General tab → Group dropdown) to the *same* group the parcel
is deeded to. Only then will group members (with that group set active) be recognized —
see the comment above `isParcelOwner()` for why. Skipping this step means nobody at all
can pass the check on group-owned land, individual or otherwise.

## Browser HUD dialog structure

Root menu: **Browse All / Filters / Open Web** (the last uses `llLoadURL` to the site,
configured via `SITE_URL` in `browser_hud.lsl` — keep it pointed at wherever GitHub Pages
is actually serving `docs/`). **Filters** leads to a sort-order picker — **Population /
Name / Theme / Back** — matching `docs/app.js`'s `SORTERS` keys (`population_desc`,
`name_asc`, `theme_asc`); it is a sort order, not a theme-value filter.

The venue-list dialog itself uses bare-number buttons (`1`–`4`, `PAGE_SIZE = 4`) rather
than putting venue names on the buttons — button labels are capped at 24 UTF-8 bytes each,
which forces heavy truncation, while the dialog's shared message text has much more room
(each line is just `"N. Name — Population"`). Selecting a number shows a detail dialog
with the full name/theme/population/region and Teleport/Back.

## Venue cover photo

LSL cannot read a parcel's About Land snapshot — there's no `PARCEL_DETAILS_*` flag
for it. Instead, the Owner Publish Object looks for a texture named exactly
**`Venue Photo`** (see `PHOTO_TEXTURE_NAME` in `owner_publish_object.lsl`) in its own
Contents/inventory and sends that texture's UUID at publish time.

**Important:** `llGetInventoryKey()` only returns a real UUID for full-permission
(copy + modify + transfer) inventory items — for anything else (most marketplace
textures) it silently returns `NULL_KEY` and no photo gets sent, with no error shown.
The reliable way to get a usable texture: take an in-world **Snapshot to Inventory**
(viewer snapshot floater) — your own snapshots are always full permission — then
rename it to `Venue Photo` and drop it in the object.

The site renders it via Second Life's Picture Service (unofficial, undocumented by
Linden Lab, but working as of this writing — see
[wiki.secondlife.com/wiki/Picture_Service](https://wiki.secondlife.com/wiki/Picture_Service)):
`https://picture-service.secondlife.com/<uuid>/320x240.jpg` (320x240 is the largest size
it offers — it's thumbnail-only, not full resolution). If a texture fails to resolve
there (deleted asset, etc.) the card just falls back to a theme-colored gradient — see
`docs/app.js`'s `renderCard()` and the `.venue-photo-wrap[data-theme="..."]` rules in
`docs/styles.css`.
