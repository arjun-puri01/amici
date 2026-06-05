-- Add shared_at_1 / shared_at_2 to the connections table.
-- These timestamps record when each participant submitted their share choices.
-- handle-share uses them to determine when both sides have submitted and
-- it is safe to reveal each user's actual contact information.

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS shared_at_1 timestamptz,
  ADD COLUMN IF NOT EXISTS shared_at_2 timestamptz;
