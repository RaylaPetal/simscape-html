// POST /functions/v1/heartbeat
// Called every ~5 minutes by the Owner Publish Object while published, to report
// current parcel population and prove it still holds a valid secret_token.
//
// Important: this function NEVER extends expires_at. A listing can only be
// (re-)published for 6 or 24 hours via publish() — heartbeat exists purely to
// keep population fresh, not to make a listing effectively permanent.
//
// Deployed with verify_jwt = false; see supabase/config.toml and publish/index.ts.

import { createClient } from "npm:@supabase/supabase-js@2";
import { isUuid, sha256Hex, jsonResponse } from "../_shared/venues.ts";

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

  const { venue_id, secret_token, population } = body;

  if (!isUuid(venue_id)) return jsonResponse({ ok: false, error: "invalid_venue_id" }, 422);
  if (typeof secret_token !== "string" || secret_token.length < 32) {
    return jsonResponse({ ok: false, error: "invalid_secret_token" }, 422);
  }
  if (typeof population !== "number" || !Number.isFinite(population) || population < 0) {
    return jsonResponse({ ok: false, error: "invalid_population" }, 422);
  }

  const { data: venue, error: fetchError } = await supabase
    .from("venues")
    .select("id, secret_token_hash, expires_at")
    .eq("id", venue_id)
    .maybeSingle();

  if (fetchError) {
    console.error("heartbeat lookup failed", fetchError);
    return jsonResponse({ ok: false, error: "db_error" }, 500);
  }
  if (!venue) {
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  }

  const providedHash = await sha256Hex(secret_token);
  if (providedHash !== venue.secret_token_hash) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const expiresAt = new Date(venue.expires_at);
  if (expiresAt.getTime() <= Date.now()) {
    return jsonResponse({
      ok: false,
      error: "expired",
      expires_at_unix: Math.floor(expiresAt.getTime() / 1000),
    }, 403);
  }

  const { error: updateError } = await supabase
    .from("venues")
    .update({
      population: Math.round(population),
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq("id", venue_id);

  if (updateError) {
    console.error("heartbeat update failed", updateError);
    return jsonResponse({ ok: false, error: "db_error" }, 500);
  }

  const secondsRemaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return jsonResponse({
    ok: true,
    expires_at_unix: Math.floor(expiresAt.getTime() / 1000),
    seconds_remaining: secondsRemaining,
  });
});
