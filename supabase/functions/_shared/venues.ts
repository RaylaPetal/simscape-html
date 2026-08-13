// Shared by the publish/heartbeat/delist Edge Functions. Keep in sync with
// the CHECK constraint in supabase/migrations/0001_init_venues.sql and with
// /lsl/shared_reference/themes.md (LSL scripts can't import this directly).

export const THEMES = [
  "BDSM", "Club", "Venue", "Hangout", "Dating",
  "Roleplay", "Live Music", "Shopping", "Other",
] as const;

export const DURATION_HOURS = [2, 4, 6, 12, 24] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isTheme(value: unknown): value is (typeof THEMES)[number] {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function isDurationHours(value: unknown): value is (typeof DURATION_HOURS)[number] {
  return typeof value === "number" && (DURATION_HOURS as readonly number[]).includes(value);
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateSecretToken(): string {
  // 32 random bytes, hex-encoded — opaque, unguessable, no external deps.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildSlurl(regionName: string, x: number, y: number, z: number): string {
  const region = encodeURIComponent(regionName);
  return `https://maps.secondlife.com/secondlife/${region}/${Math.round(x)}/${Math.round(y)}/${Math.round(z)}`;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
