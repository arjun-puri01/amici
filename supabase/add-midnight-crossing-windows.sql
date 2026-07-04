-- Migration: midnight-crossing active windows
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Active windows are stored as (day_of_week, start_time, end_time). A window
-- where start_time > end_time (e.g. 22:00–02:00) CROSSES MIDNIGHT: its tail
-- (00:00–end) belongs to the FOLLOWING calendar day. The previous checks
-- assumed start < end and same-day only, so they neither recognized the evening
-- portion of a crossing window nor its post-midnight tail — meaning matches
-- couldn't fire after midnight.
--
-- All time-of-day comparisons remain in America/New_York (Brown's zone),
-- unchanged. Only the window-coverage logic changes.

-- ─── 1. is_in_active_window ───────────────────────────────────────────
-- True if `now` (Eastern) falls inside one of the user's windows, accounting
-- for midnight-crossing windows. A window (D, S, E) covers now when:
--   normal   (S < E): day = D            and S <= t < E
--   crossing (S > E): evening  -> day = D            and t >= S
--                     morning  -> day = D+1 (mod 7)  and t <  E
--   S = E: zero-length, never active (matches the client).

create or replace function public.is_in_active_window(target_user_id uuid)
returns boolean
language sql
security definer
as $$
  with n as (
    select
      extract(dow from now() at time zone 'America/New_York')::int as d,
      (now() at time zone 'America/New_York')::time                as t
  )
  select exists (
    select 1
    from public.active_windows aw, n
    where aw.user_id = target_user_id
      and (
        -- normal same-day window
        (aw.start_time < aw.end_time
          and aw.day_of_week = n.d
          and aw.start_time <= n.t and n.t < aw.end_time)
        -- crossing window, evening portion (today)
        or (aw.start_time > aw.end_time
          and aw.day_of_week = n.d
          and n.t >= aw.start_time)
        -- crossing window, morning tail (started yesterday)
        or (aw.start_time > aw.end_time
          and aw.day_of_week = (n.d + 6) % 7
          and n.t < aw.end_time)
      )
  )
$$;

-- ─── 2. find_nearby_candidates ────────────────────────────────────────
-- Full replacement identical to the add-brown-dorm-zones.sql version EXCEPT the
-- candidate "active window" check now delegates to is_in_active_window(u.id),
-- so the midnight-crossing logic lives in exactly one place. Everything else
-- about matching (radius, dorm zones, triggers, 24h dedup) is unchanged.

create or replace function public.find_nearby_candidates(
  caller_id    uuid,
  caller_lat   double precision,
  caller_lng   double precision,
  radius_m     double precision default 50,
  lookback_min int              default 5
)
returns table (
  user_id           uuid,
  first_name        text,
  profile_photo_url text,
  trigger_type      text,
  trigger_value     text,
  b_lat             double precision,
  b_lng             double precision
)
language sql
security definer
as $$
  with
  caller as (
    select hometown_city, hometown_state
    from public.users
    where id = caller_id
  ),
  caller_interests as (
    select interest_id from public.user_interests where user_id = caller_id
  ),
  latest_pings as (
    select distinct on (user_id)
      user_id, lat, lng, location
    from public.location_pings
    where timestamp >= now() - (lookback_min || ' minutes')::interval
    order by user_id, timestamp desc
  ),
  shared_interests as (
    select ui.user_id, i.label
    from public.user_interests ui
    join public.interests i on i.id = ui.interest_id
    where ui.interest_id in (select interest_id from caller_interests)
      and ui.user_id != caller_id
  )
  select
    u.id                  as user_id,
    u.first_name,
    u.profile_photo_url,
    case
      when u.hometown_city  = c.hometown_city
       and u.hometown_state = c.hometown_state
       and c.hometown_city  is not null
      then 'hometown'
      else 'interest'
    end                   as trigger_type,
    case
      when u.hometown_city  = c.hometown_city
       and u.hometown_state = c.hometown_state
       and c.hometown_city  is not null
      then c.hometown_city || ', ' || c.hometown_state
      else (select label from shared_interests si where si.user_id = u.id limit 1)
    end                   as trigger_value,
    lp.lat                as b_lat,
    lp.lng                as b_lng
  from public.users u
  cross join caller c
  join latest_pings lp on lp.user_id = u.id
  where u.id != caller_id

    -- Within matching radius of the caller
    and st_dwithin(
      lp.location,
      st_setsrid(st_makepoint(caller_lng, caller_lat), 4326)::geography,
      radius_m
    )

    -- Candidate is in their own active window (midnight-crossing aware)
    and public.is_in_active_window(u.id)

    -- Candidate is NOT inside their personal dorm exclusion zone
    and not exists (
      select 1 from public.dorm_exclusion_zones dez
      where dez.user_id = u.id
        and st_dwithin(lp.location, dez.location, dez.radius_meters)
    )

    -- Candidate is NOT inside any Brown campus dorm building
    and not exists (
      select 1 from public.brown_dorm_zones bdz
      where st_dwithin(lp.location, bdz.location, bdz.radius_meters)
    )

    -- Shares at least one trigger (hometown OR interest)
    and (
      (
        u.hometown_city  = c.hometown_city
        and u.hometown_state = c.hometown_state
        and c.hometown_city  is not null
      )
      or exists (select 1 from shared_interests si where si.user_id = u.id)
    )

    -- Not already matched with the caller in the last 24 hours
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
