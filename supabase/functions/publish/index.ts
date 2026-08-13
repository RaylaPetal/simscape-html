// POST /functions/v1/publish
// Called by the in-world Owner Publish Object LSL script when the owner touches it
// and picks a theme + duration. Upserts by object_key (the object's llGetKey()),
// so re-publishing the same object updates its existing row instead of creating a
// duplicate. Returns a fresh secret_token every call — heartbeat() only accepts the
// most recent one, which also means "Update Now" naturally invalidates old tokens.
//
// Deployed with verify_jwt = false (see supabase/config.toml): LSL is not an OAuth
// client, so this function validates its own input instead of trusting a JWT.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  isUuid, isTheme, isDurationHours,
  sha256Hex, generateSecretToken, buildSlurl, jsonResponse,
} from "../_shared/venues.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  const {
    object_key, parcel_name, region_name, owner_key, owner_name,
    local_x, local_y, local_z, theme, duration_hours, photo_texture_uuid, population,
  } = body;

  if (!isUuid(object_key)) return jsonResponse({ ok: false, error: "invalid_object_key" }, 422);
  if (!isUuid(owner_key)) return jsonResponse({ ok: false, error: "invalid_owner_key" }, 422);
  if (typeof parcel_name !== "string" || parcel_name.length < 1 || parcel_name.length > 64) {
    return jsonResponse({ ok: false, error: "invalid_parcel_name" }, 422);
  }
  if (typeof region_name !== "string" || region_name.length < 1) {
    return jsonResponse({ ok: false, error: "invalid_region_name" }, 422);
  }
  if (![local_x, local_y, local_z].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return jsonResponse({ ok: false, error: "invalid_position" }, 422);
  }
  if (!isTheme(theme)) return jsonResponse({ ok: false, error: "invalid_theme" }, 422);
  if (!isDurationHours(duration_hours)) {
    return jsonResponse({ ok: false, error: "invalid_duration_hours" }, 422);
  }
  // Optional: the venue's cover photo, from a texture named "Venue Photo" in the
  // Publish Object's inventory. Omitted entirely (not just falsy) means "no
  // texture found" — anything present must be a real UUID, not silently ignored.
  if (photo_texture_uuid !== undefined && photo_texture_uuid !== null && !isUuid(photo_texture_uuid)) {
    return jsonResponse({ ok: false, error: "invalid_photo_texture_uuid" }, 422);
  }
  // Optional: current parcel population at publish time, so the site doesn't show 0
  // until the first heartbeat (up to HEARTBEAT_INTERVAL later). Missing/invalid = 0.
  const initialPopulation =
    typeof population === "number" && Number.isFinite(population) && population >= 0
      ? Math.round(population)
      : 0;

  const { data: ban } = await supabase
    .from("banned_owners")
    .select("banned_until")
    .eq("owner_key", owner_key)
    .maybeSingle();
  if (ban && (ban.banned_until === null || new Date(ban.banned_until).getTime() > Date.now())) {
    return jsonResponse({ ok: false, error: "banned" }, 403);
  }

  const secretToken = generateSecretToken();
  const secretTokenHash = await sha256Hex(secretToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (duration_hours as number) * 3600_000);
  const slurl = buildSlurl(region_name as string, local_x as number, local_y as number, local_z as number);

  const { data, error } = await supabase
    .from("venues")
    .upsert(
      {
        object_key,
        name: parcel_name,
        theme,
        region_name,
        local_x, local_y, local_z,
        slurl,
        owner_key,
        owner_name: typeof owner_name === "string" ? owner_name : null,
        secret_token_hash: secretTokenHash,
        duration_hours,
        published_at: now.toISOString(),
        last_heartbeat_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        population: initialPopulation,
        // Explicit null (not omitted) when absent, so a republish without a
        // texture in inventory clears any previously set photo rather than
        // leaving a stale one behind.
        photo_texture_uuid: typeof photo_texture_uuid === "string" ? photo_texture_uuid : null,
      },
      { onConflict: "object_key" },
    )
    .select("id")
    .single();

  if (error) {
    console.error("publish upsert failed", error);
    return jsonResponse({ ok: false, error: "db_error" }, 500);
  }

  return jsonResponse({
    ok: true,
    venue_id: data.id,
    secret_token: secretToken,
    expires_at: expiresAt.toISOString(),
    expires_at_unix: Math.floor(expiresAt.getTime() / 1000),
  });
});
