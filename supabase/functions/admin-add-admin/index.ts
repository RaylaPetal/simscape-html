// POST /functions/v1/admin-add-admin
// Called from the admin board (authenticated Supabase session) to grant someone
// else admin access. Sends them an email invite (they set their own password) and
// records them in `admins`. This is the ONLY way rows get written to `admins` —
// see supabase/migrations/0006_admin_system.sql for why direct client writes to
// that table are never allowed, even for existing admins.
//
// Deployed with verify_jwt = true (the default — see supabase/config.toml): the
// gateway only guarantees the Authorization header is *some* valid Supabase JWT
// (which includes the public anon key). It does NOT guarantee a real logged-in
// admin, so this function still explicitly resolves the caller via getUser() and
// checks `admins` itself before doing anything privileged.

import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/venues.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const adminClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ ok: false, error: "missing_token" }, 401);

  const { data: userData, error: userError } = await adminClient.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ ok: false, error: "invalid_token" }, 401);
  }
  const caller = userData.user;

  const { data: callerAdmin } = await adminClient
    .from("admins")
    .select("user_id")
    .eq("user_id", caller.id)
    .maybeSingle();
  if (!callerAdmin) {
    return jsonResponse({ ok: false, error: "not_an_admin" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  const { email } = body;
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return jsonResponse({ ok: false, error: "invalid_email" }, 422);
  }

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email);
  if (inviteError || !invited?.user) {
    console.error("invite failed", inviteError);
    return jsonResponse({ ok: false, error: "invite_failed", message: inviteError?.message ?? null }, 500);
  }

  const { error: insertError } = await adminClient.from("admins").insert({
    user_id: invited.user.id,
    email,
    added_by: caller.id,
  });
  if (insertError) {
    console.error("admins insert failed", insertError);
    return jsonResponse({ ok: false, error: "db_error" }, 500);
  }

  return jsonResponse({ ok: true, user_id: invited.user.id, email });
});
