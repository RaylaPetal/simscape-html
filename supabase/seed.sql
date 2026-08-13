-- Sample data for Stage 3 (static site) testing against a real Supabase project,
-- without needing live LSL objects yet. Includes one already-expired row to confirm
-- it's correctly hidden from public_venues / the site.
--
-- secret_token_hash values here are arbitrary placeholder hex strings, not derived
-- from any real token, since these rows are only for read-path testing and are
-- never meant to receive real heartbeat/delist calls.

insert into public.venues
  (object_key, name, theme, population, region_name, local_x, local_y, local_z,
   slurl, owner_key, owner_name, secret_token_hash, duration_hours,
   published_at, last_heartbeat_at, expires_at)
values
  ('11111111-1111-1111-1111-111111111111', 'Test Venue', 'BDSM', 10,
   'Test Region', 128, 128, 25,
   'https://maps.secondlife.com/secondlife/Test%20Region/128/128/25',
   '22222222-2222-2222-2222-222222222222', 'Owner Resident',
   '3b1889c4e0b96f7bcb70ea3c7b556f0e9f0ef53c2dd7fce6c37bb8ff7c1efb9d', 6,
   now(), now(), now() + interval '6 hours'),

  ('33333333-3333-3333-3333-333333333333', 'Midnight Lounge', 'Club', 34,
   'Neon City', 64, 200, 30,
   'https://maps.secondlife.com/secondlife/Neon%20City/64/200/30',
   '44444444-4444-4444-4444-444444444444', 'DJ Resident',
   '3b1889c4e0b96f7bcb70ea3c7b556f0e9f0ef53c2dd7fce6c37bb8ff7c1efb9d', 24,
   now(), now(), now() + interval '24 hours'),

  ('55555555-5555-5555-5555-555555555555', 'The Quiet Hangout', 'Hangout', 3,
   'Serenity', 150, 150, 22,
   'https://maps.secondlife.com/secondlife/Serenity/150/150/22',
   '66666666-6666-6666-6666-666666666666', 'Chill Resident',
   '3b1889c4e0b96f7bcb70ea3c7b556f0e9f0ef53c2dd7fce6c37bb8ff7c1efb9d', 6,
   now(), now(), now() + interval '2 hours'),

  ('77777777-7777-7777-7777-777777777777', 'Expired Venue (should be hidden)', 'Dating', 5,
   'Old Region', 100, 100, 25,
   'https://maps.secondlife.com/secondlife/Old%20Region/100/100/25',
   '88888888-8888-8888-8888-888888888888', 'Gone Resident',
   '3b1889c4e0b96f7bcb70ea3c7b556f0e9f0ef53c2dd7fce6c37bb8ff7c1efb9d', 6,
   now() - interval '7 hours', now() - interval '1 hour', now() - interval '1 hour');
