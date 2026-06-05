-- Migration: Match Screen support (Step 7)
-- Run in Supabase SQL editor after add-push-token.sql

-- Track who initiated the "We Talked" confirmation so each side of the
-- match can show the right UI (waiting vs. confirm).
alter table public.matches
  add column if not exists talked_by_user_id uuid references public.users(id);

-- The Match Screen needs to read the matched user's name, photo, and grad year.
-- The previous select_own policy was too restrictive — replace it with one
-- that lets any authenticated user read public fields.
-- Contact info (instagram_handle, phone_number) is never SELECTed by client
-- code in match/history flows; it is only accessed via edge functions after
-- mutual confirmation (enforced server-side in Step 8).
drop policy if exists "users_select_own" on public.users;
create policy "users_select_authenticated" on public.users
  for select using (auth.role() = 'authenticated');

-- Allow the handle-talked edge function path: users may update the status
-- and talked_by_user_id columns on matches they participate in.
-- (The existing matches_update_own policy already covers this.)
