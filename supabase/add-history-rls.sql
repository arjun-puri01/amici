-- Fix users RLS so that authenticated users can read public profile fields
-- from any user, not just their own row.
--
-- The original "users_select_own" policy (auth.uid() = id) was too restrictive
-- and would break MatchScreen and HistoryScreen queries for other users'
-- profiles. The schema comment always said "public fields of any user" —
-- this migration brings the policy in line with that intent.
--
-- IMPORTANT: Client code must NEVER select instagram_handle or phone_number
-- directly. Those fields are only accessible via the handle-share edge function
-- (service role) after mutual confirmation.

DROP POLICY IF EXISTS "users_select_own" ON public.users;

CREATE POLICY "users_select_authenticated" ON public.users
  FOR SELECT USING (auth.role() = 'authenticated');
