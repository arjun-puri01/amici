-- ============================================================
-- Amici — SQL helper functions for the match-users edge function.
-- Run this in the Supabase SQL editor after schema.sql.
-- All functions use SECURITY DEFINER so they run as the owner
-- and bypass RLS — they are only called from the edge function
-- which independently verifies the caller's identity via JWT.
-- ============================================================

-- ─── is_in_active_window ─────────────────────────────────────
-- Returns true if the current wall-clock time (Eastern Time,
-- hardcoded for Brown University / Providence RI) falls within
-- any of the user's configured active windows for today.

create or replace function public.is_in_active_window(target_user_id uuid)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1 from public.active_windows
    where user_id = target_user_id
      and day_of_week = extract(dow from now() at time zone 'America/New_York')::int
      and start_time  <= (now() at time zone 'America/New_York')::time
      and end_time    >  (now() at time zone 'America/New_York')::time
  );
$$;

-- ─── is_in_dorm_zone ─────────────────────────────────────────
-- Returns true if the given lat/lng is within the user's dorm
-- exclusion zone radius. If the user has no exclusion zone set,
-- returns false (no exclusion applied).

create or replace function public.is_in_dorm_zone(
  target_user_id uuid,
  ref_lat        double precision,
  ref_lng        double precision
)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1 from public.dorm_exclusion_zones
    where user_id = target_user_id
      and st_dwithin(
        location,
        st_setsrid(st_makepoint(ref_lng, ref_lat), 4326)::geography,
        radius_meters
      )
  );
$$;

-- ─── find_nearby_candidates ──────────────────────────────────
-- Core candidate query for the matching pipeline. Given the caller's
-- location, returns other users who:
--   1. Pinged within the last lookback_min minutes
--   2. Are within radius_m meters of the caller's current location
--   3. Are currently inside their own active window
--   4. Are NOT inside their own dorm exclusion zone
--   5. Share at least one trigger with the caller (hometown OR interest)
--   6. Have NOT been matched with the caller in the last 24 hours
--
-- Also returns b_lat/b_lng (the candidate's latest location) so the
-- caller can run the reverse persistence check (A near B) cheaply.
-- trigger_type and trigger_value are pre-computed for the match record.

create or replace function public.find_nearby_candidates(
  caller_id   uuid,
  caller_lat  double precision,
  caller_lng  double precision,
  radius_m    double precision default 50,
  lookback_min int             default 5
)
returns table (
  user_id          uuid,
  first_name       text,
  profile_photo_url text,
  trigger_type     text,
  trigger_value    text,
  b_lat            double precision,
  b_lng            double precision
)
language sql
security definer
as $$
  with
  -- Caller's home info for hometown trigger comparison
  caller as (
    select hometown_city, hometown_state
    from public.users
    where id = caller_id
  ),
  -- Caller's interest IDs for shared-interest detection
  caller_interests as (
    select interest_id from public.user_interests where user_id = caller_id
  ),
  -- Most recent ping per user within the lookback window
  latest_pings as (
    select distinct on (user_id)
      user_id, lat, lng, location
    from public.location_pings
    where timestamp >= now() - (lookback_min || ' minutes')::interval
    order by user_id, timestamp desc
  ),
  -- Interests shared between each nearby user and the caller
  -- (resolved to their display label for the notification)
  shared_interests as (
    select ui.user_id, i.label
    from public.user_interests ui
    join public.interests i on i.id = ui.interest_id
    where ui.interest_id in (select interest_id from caller_interests)
      and ui.user_id != caller_id
  )
  select
    u.id                 as user_id,
    u.first_name,
    u.profile_photo_url,
    -- Hometown takes priority when both triggers match; all triggers are
    -- otherwise equal per spec, so first-found ordering is acceptable.
    case
      when u.hometown_city  = c.hometown_city
       and u.hometown_state = c.hometown_state
       and c.hometown_city  is not null
      then 'hometown'
      else 'interest'
    end                  as trigger_type,
    case
      when u.hometown_city  = c.hometown_city
       and u.hometown_state = c.hometown_state
       and c.hometown_city  is not null
      then c.hometown_city || ', ' || c.hometown_state
      else (select label from shared_interests si where si.user_id = u.id limit 1)
    end                  as trigger_value,
    lp.lat               as b_lat,
    lp.lng               as b_lng
  from public.users u
  cross join caller c
  join latest_pings lp on lp.user_id = u.id
  where u.id != caller_id

    -- ── Proximity ───────────────────────────────────────────
    and st_dwithin(
      lp.location,
      st_setsrid(st_makepoint(caller_lng, caller_lat), 4326)::geography,
      radius_m
    )

    -- ── Candidate is in their own active window ─────────────
    and exists (
      select 1 from public.active_windows aw
      where aw.user_id    = u.id
        and aw.day_of_week = extract(dow from now() at time zone 'America/New_York')::int
        and aw.start_time <=  (now() at time zone 'America/New_York')::time
        and aw.end_time   >   (now() at time zone 'America/New_York')::time
    )

    -- ── Candidate is NOT in their dorm exclusion zone ───────
    and not exists (
      select 1 from public.dorm_exclusion_zones dez
      where dez.user_id = u.id
        and st_dwithin(lp.location, dez.location, dez.radius_meters)
    )

    -- ── Shared trigger (hometown OR at least one interest) ──
    and (
      (
        u.hometown_city  = c.hometown_city
        and u.hometown_state = c.hometown_state
        and c.hometown_city  is not null
      )
      or exists (select 1 from shared_interests si where si.user_id = u.id)
    )

    -- ── Not already matched in last 24 hours ────────────────
    and not exists (
      select 1 from public.matches m
      where (
        (m.user_id_1 = caller_id and m.user_id_2 = u.id)
        or
        (m.user_id_1 = u.id     and m.user_id_2 = caller_id)
      )
      and m.fired_at >= now() - interval '24 hours'
    )
$$;

-- ─── count_pings_near_point ──────────────────────────────────
-- Counts how many of a user's recent pings (up to max_pings most
-- recent within lookback_min minutes) fall within radius_m meters
-- of a reference point. Used for the 3-minute persistence filter:
-- a count >= 3 means the user has been near that point for at least
-- ~3 minutes (given 1 ping/minute cadence).

create or replace function public.count_pings_near_point(
  target_user_id uuid,
  ref_lat        double precision,
  ref_lng        double precision,
  radius_m       double precision default 50,
  lookback_min   int              default 5,
  max_pings      int              default 3
)
returns int
language sql
security definer
as $$
  select count(*)::int
  from (
    select 1
    from public.location_pings
    where user_id  = target_user_id
      and timestamp >= now() - (lookback_min || ' minutes')::interval
      and st_dwithin(
        location,
        st_setsrid(st_makepoint(ref_lng, ref_lat), 4326)::geography,
        radius_m
      )
    order by timestamp desc
    limit max_pings
  ) sub
$$;
