-- ============================================================
-- Amici — Supabase schema
-- Run this in the Supabase SQL editor to bootstrap the database.
-- ============================================================

-- Enable PostGIS for geospatial queries (used in matching logic)
create extension if not exists postgis;

-- ─── Tables ──────────────────────────────────────────────────

create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null unique,
  first_name      text,
  profile_photo_url text,
  graduation_year int,
  hometown_city   text,
  hometown_state  text,
  -- Contact info is stored server-side and NEVER returned to clients
  -- until mutual confirmation is complete (enforced via RLS + edge function)
  instagram_handle text,
  phone_number    text,
  created_at      timestamptz not null default now()
);

create table if not exists public.interests (
  id       uuid primary key default gen_random_uuid(),
  label    text not null unique,
  category text not null
);

create table if not exists public.user_interests (
  user_id     uuid not null references public.users(id) on delete cascade,
  interest_id uuid not null references public.interests(id) on delete cascade,
  primary key (user_id, interest_id)
);

-- day_of_week: 0 = Sunday … 6 = Saturday
create table if not exists public.active_windows (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  day_of_week  int  not null check (day_of_week between 0 and 6),
  start_time   time not null,
  end_time     time not null
);

-- location_pings uses PostGIS geometry for efficient proximity queries
create table if not exists public.location_pings (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.users(id) on delete cascade,
  lat       double precision not null,
  lng       double precision not null,
  location  geography(Point, 4326),  -- populated by trigger below
  timestamp timestamptz not null default now()
);

create table if not exists public.matches (
  id            uuid primary key default gen_random_uuid(),
  user_id_1     uuid not null references public.users(id) on delete cascade,
  user_id_2     uuid not null references public.users(id) on delete cascade,
  trigger_type  text not null check (trigger_type in ('hometown', 'interest')),
  trigger_value text not null,
  fired_at      timestamptz not null default now(),
  status        text not null default 'pending'
                check (status in ('pending', 'talked', 'connected', 'missed'))
);

create table if not exists public.connections (
  id                  uuid primary key default gen_random_uuid(),
  match_id            uuid not null references public.matches(id) on delete cascade,
  user_id_1           uuid not null references public.users(id) on delete cascade,
  user_id_2           uuid not null references public.users(id) on delete cascade,
  shared_instagram_1  boolean not null default false,
  shared_instagram_2  boolean not null default false,
  shared_phone_1      boolean not null default false,
  shared_phone_2      boolean not null default false,
  connected_at        timestamptz not null default now()
);

create table if not exists public.dorm_exclusion_zones (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references public.users(id) on delete cascade,
  lat            double precision not null,
  lng            double precision not null,
  location       geography(Point, 4326),
  radius_meters  int not null default 100
);

-- ─── Indexes ─────────────────────────────────────────────────

-- Geospatial index for proximity queries on location_pings
create index if not exists location_pings_location_idx
  on public.location_pings using gist (location);

-- Speed up "pings in last N minutes" queries
create index if not exists location_pings_timestamp_idx
  on public.location_pings (timestamp desc);

-- Speed up "has pair matched in last 24h" check
create index if not exists matches_pair_idx
  on public.matches (user_id_1, user_id_2, fired_at);

-- ─── Triggers ────────────────────────────────────────────────

-- Automatically populate the PostGIS geometry column from lat/lng on insert
create or replace function public.set_ping_location()
returns trigger language plpgsql as $$
begin
  new.location := st_point(new.lng, new.lat)::geography;
  return new;
end;
$$;

drop trigger if exists set_ping_location_trigger on public.location_pings;
create trigger set_ping_location_trigger
  before insert on public.location_pings
  for each row execute function public.set_ping_location();

-- Same for dorm exclusion zones
create or replace function public.set_dorm_location()
returns trigger language plpgsql as $$
begin
  new.location := st_point(new.lng, new.lat)::geography;
  return new;
end;
$$;

drop trigger if exists set_dorm_location_trigger on public.dorm_exclusion_zones;
create trigger set_dorm_location_trigger
  before insert or update on public.dorm_exclusion_zones
  for each row execute function public.set_dorm_location();

-- Create a public.users row when a new auth.users record is inserted.
-- Extracts first_name from user_metadata if provided (set during sign-up).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, first_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'first_name'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Row Level Security ───────────────────────────────────────

alter table public.users enable row level security;
alter table public.interests enable row level security;
alter table public.user_interests enable row level security;
alter table public.active_windows enable row level security;
alter table public.location_pings enable row level security;
alter table public.matches enable row level security;
alter table public.connections enable row level security;
alter table public.dorm_exclusion_zones enable row level security;

-- users: authenticated users can read public fields of any user,
--        but can only write their own row.
--        Contact info (instagram_handle, phone_number) is excluded via a
--        separate secure view — clients never select it directly.
create policy "users_select_own" on public.users
  for select using (auth.uid() = id);

create policy "users_update_own" on public.users
  for update using (auth.uid() = id);

-- interests: readable by all authenticated users (for onboarding picker)
create policy "interests_select_all" on public.interests
  for select using (auth.role() = 'authenticated');

create policy "interests_insert_auth" on public.interests
  for insert with check (auth.role() = 'authenticated');

-- user_interests: users manage their own
create policy "user_interests_own" on public.user_interests
  for all using (auth.uid() = user_id);

-- active_windows: users manage their own
create policy "active_windows_own" on public.active_windows
  for all using (auth.uid() = user_id);

-- location_pings: users write their own; no direct read (edge function only)
create policy "pings_insert_own" on public.location_pings
  for insert with check (auth.uid() = user_id);

-- matches: users can read matches they are part of
create policy "matches_read_own" on public.matches
  for select using (auth.uid() = user_id_1 or auth.uid() = user_id_2);

create policy "matches_update_own" on public.matches
  for update using (auth.uid() = user_id_1 or auth.uid() = user_id_2);

-- connections: users can read connections they are part of
create policy "connections_read_own" on public.connections
  for select using (auth.uid() = user_id_1 or auth.uid() = user_id_2);

-- dorm exclusion zones: users manage their own
create policy "dorm_own" on public.dorm_exclusion_zones
  for all using (auth.uid() = user_id);

-- ─── Storage RLS policies (profile-photos bucket) ───────────
-- Storage policies live on storage.objects, not a public table.
-- The path structure is: {user_id}/profile.{ext}
-- storage.foldername(name)[1] extracts the first path segment (the user_id folder).

create policy "profile_photos_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile_photos_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Photos are public — anyone (including unauthenticated) can read them
-- so notification thumbnails render without auth headers.
create policy "profile_photos_select"
  on storage.objects for select
  to public
  using (bucket_id = 'profile-photos');

-- ─── Auto-delete stale location pings (> 24 hours) ───────────
-- Schedule this via pg_cron (enable in Supabase dashboard: Database > Extensions)
-- or call it from the match edge function on each ping.
create or replace function public.delete_stale_pings()
returns void language sql as $$
  delete from public.location_pings
  where timestamp < now() - interval '24 hours';
$$;
