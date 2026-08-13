// POST /functions/v1/delist
// Optional: lets an owner pull their listing early ("Delist Now" in the re-touch
// menu) instead of waiting out the full 6h/24h window. Just sets expires_at to
// now — the same read-time filter that handles normal expiry also handles this,
// no separate "is_active" flag needed.

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

  const { venue_id, secret_token } = body;

  if (!isUuid(venue_id)) return jsonResponse({ ok: false, error: "invalid_venue_id" }, 422);
  if (typeof secret_token !== "string" || secret_token.length < 32) {
    return jsonResponse({ ok: false, error: "invalid_secret_token" }, 422);
  }

  const { data: venue, error: fetchError } = await supabase
    .from("venues")
    .select("id, secret_token_hash")
    .eq("id", venue_id)
    .maybeSingle();

  if (fetchError) {
    console.error("delist lookup failed", fetchError);
    return jsonResponse({ ok: false, error: "db_error" }, 500);
  }
  if (!venue) return jsonResponse({ ok: false, error: "not_found" }, 404);

  const providedHash = await sha256Hex(secret_token);
  if (providedHash !== venue.secret_token_hash) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("venues")
    .update({ expires_at: now })
    .eq("id", venue_id);

  if (updateError) {
    console.error("delist update failed", updateError);
    return jsonResponse({ ok: false, error: "db_error" }, 500);
  }

  return jsonResponse({ ok: true });
});
