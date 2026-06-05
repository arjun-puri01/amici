-- Migration: Step 10 — Brown University campus dorm zones
-- Run in Supabase SQL editor.
--
-- Creates a system-wide table of Brown University dorm building centers
-- with a 50-meter exclusion radius each. Updates is_in_dorm_zone and
-- find_nearby_candidates so both the caller guard (step 5 of match-users)
-- and the candidate filter exclude anyone inside a campus dorm building.
-- Personal dorm_exclusion_zones (set during onboarding) still apply too.

-- ─── 1. Table ─────────────────────────────────────────────────────────

create table if not exists public.brown_dorm_zones (
  id            uuid primary key default gen_random_uuid(),
  lat           double precision not null,
  lng           double precision not null,
  location      geography(Point, 4326),
  radius_meters int not null default 50
);

create index if not exists brown_dorm_zones_location_idx
  on public.brown_dorm_zones using gist (location);

-- Trigger to auto-populate the PostGIS geography column on insert/update.
create or replace function public.set_brown_dorm_location()
returns trigger language plpgsql as $$
begin
  new.location := st_point(new.lng, new.lat)::geography;
  return new;
end;
$$;

drop trigger if exists set_brown_dorm_location_trigger on public.brown_dorm_zones;
create trigger set_brown_dorm_location_trigger
  before insert or update on public.brown_dorm_zones
  for each row execute function public.set_brown_dorm_location();

-- ─── 2. Brown University dorm buildings (36 buildings, 50 m radius) ──

insert into public.brown_dorm_zones (lat, lng) values
  (41.82397349625401,   -71.40330022314183),
  (41.824397884153136,  -71.40287053595868),
  (41.823983287390966,  -71.4038372995479),
  (41.83018397429883,   -71.40277895324688),
  (41.830590956532184,  -71.40247710183436),
  (41.83027607693724,   -71.40222988007228),
  (41.83036754300238,   -71.40110865455327),
  (41.830469113029956,  -71.40150663946244),
  (41.83061058468811,   -71.40139466805748),
  (41.82940801258246,   -71.40179161037204),
  (41.82961903125751,   -71.40145896537877),
  (41.829982785214796,  -71.40164861749713),
  (41.83023975197691,   -71.40179220448688),
  (41.82371739776576,   -71.39898941503554),
  (41.82361789510438,   -71.3993834794442),
  (41.82328419361378,   -71.39982965065224),
  (41.82380749995767,   -71.39857726928714),
  (41.82395700497184,   -71.39805108272526),
  (41.82406704485712,   -71.3967998540085),
  (41.82365911160116,   -71.39623457333924),
  (41.82723377026048,   -71.39895972635617),
  (41.82672949803598,   -71.40384403672125),
  (41.825765655285856,  -71.4038322469697),
  (41.824968224730526,  -71.40248669334675),
  (41.82528497514257,   -71.40174136972445),
  (41.8245849383618,    -71.40197816670599),
  (41.82442149657996,   -71.40156086668676),
  (41.824693411557725,  -71.40128718996601),
  (41.82452154469156,   -71.40243944679331),
  (41.82415986568471,   -71.40132470947559),
  (41.824017527200475,  -71.40066244358785),
  (41.8244433750352,    -71.40040254665327),
  (41.823669533338986,  -71.40036386239633),
  (41.82363453331345,   -71.40101830217957),
  (41.823117675189614,  -71.40096193903759),
  (41.823148008006235,  -71.40030280454167)
;

-- ─── 3. is_in_dorm_zone ───────────────────────────────────────────────
-- Called by match-users step 5 to guard the caller.
-- Returns true if ref_lat/lng is inside the user's personal zone OR any
-- Brown campus dorm building.

create or replace function public.is_in_dorm_zone(
  target_user_id uuid,
  ref_lat        double precision,
  ref_lng        double precision
)
returns boolean
language sql
security definer
as $$
  select
    exists (
      select 1 from public.dorm_exclusion_zones
      where user_id = target_user_id
        and st_dwithin(
          location,
          st_setsrid(st_makepoint(ref_lng, ref_lat), 4326)::geography,
          radius_meters
        )
    )
    or
    exists (
      select 1 from public.brown_dorm_zones
      where st_dwithin(
        location,
        st_setsrid(st_makepoint(ref_lng, ref_lat), 4326)::geography,
        radius_meters
      )
    )
$$;

-- ─── 4. find_nearby_candidates ────────────────────────────────────────
-- Full replacement — adds a Brown dorm zone exclusion clause so
-- candidates whose latest ping lands inside any campus dorm are filtered
-- out, in addition to the per-user personal zone check.

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

    -- Candidate is in their own active window
    and exists (
      select 1 from public.active_windows aw
      where aw.user_id    = u.id
        and aw.day_of_week = extract(dow from now() at time zone 'America/New_York')::int
        and aw.start_time <=  (now() at time zone 'America/New_York')::time
        and aw.end_time   >   (now() at time zone 'America/New_York')::time
    )

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
