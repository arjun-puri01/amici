-- Migration: Replace placeholder interests with the curated production list.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- The existing interests table holds AI-generated placeholder rows. This wipes
-- them and inserts the real 10-category list. Existing test accounts may have
-- user_interests rows pointing at the old interests; those are placeholder
-- selections and are expected to be lost (test users will re-pick).
--
-- user_interests.interest_id is ON DELETE CASCADE, so deleting interests would
-- remove the referencing rows automatically. We still delete user_interests
-- first, explicitly, so the intent is clear and no foreign-key error can occur
-- regardless of cascade configuration.

begin;

delete from public.user_interests;
delete from public.interests;

insert into public.interests (label, category) values
  -- Sports
  ('Soccer', 'Sports'),
  ('Basketball', 'Sports'),
  ('Tennis', 'Sports'),
  ('Football', 'Sports'),
  ('Baseball', 'Sports'),
  ('Volleyball', 'Sports'),
  ('Motorsport / F1', 'Sports'),
  ('Golf', 'Sports'),
  ('Combat sports (boxing / MMA / BJJ)', 'Sports'),
  ('Racket sports (squash / badminton / table tennis)', 'Sports'),
  ('Weightlifting', 'Sports'),
  ('Running', 'Sports'),

  -- Food & Cooking
  ('Baking', 'Food & Cooking'),
  ('Italian food', 'Food & Cooking'),
  ('Japanese / sushi', 'Food & Cooking'),
  ('Mexican food', 'Food & Cooking'),
  ('Indian food', 'Food & Cooking'),
  ('Korean food', 'Food & Cooking'),
  ('Coffee & café culture', 'Food & Cooking'),
  ('Cooking', 'Food & Cooking'),
  ('Thai / Southeast Asian', 'Food & Cooking'),
  ('Vegan / vegetarian', 'Food & Cooking'),

  -- Leisure
  ('Reading', 'Leisure'),
  ('Board games', 'Leisure'),
  ('Chess', 'Leisure'),
  ('Poker / card games', 'Leisure'),
  ('Tabletop RPGs (D&D)', 'Leisure'),
  ('Puzzles', 'Leisure'),
  ('Podcasts', 'Leisure'),
  ('Collecting (vinyl / cards / sneakers)', 'Leisure'),
  ('Journaling', 'Leisure'),
  ('Astrology & tarot', 'Leisure'),

  -- Music
  ('Hip-hop / rap', 'Music'),
  ('Pop', 'Music'),
  ('Rock / indie', 'Music'),
  ('Electronic / EDM', 'Music'),
  ('Jazz', 'Music'),
  ('Classical', 'Music'),
  ('R&B / soul', 'Music'),
  ('Country', 'Music'),
  ('K-pop', 'Music'),
  ('Metal / punk', 'Music'),

  -- Video Games
  ('Valorant', 'Video Games'),
  ('League of Legends', 'Video Games'),
  ('Minecraft', 'Video Games'),
  ('Fortnite', 'Video Games'),
  ('Elden Ring / Soulslikes', 'Video Games'),
  ('Super Smash Bros', 'Video Games'),
  ('Counter-Strike', 'Video Games'),
  ('Roguelikes', 'Video Games'),
  ('Nintendo / cozy games', 'Video Games'),
  ('Retro / speedrunning', 'Video Games'),

  -- Film & TV
  ('Anime', 'Film & TV'),
  ('Horror', 'Film & TV'),
  ('Sci-fi & fantasy', 'Film & TV'),
  ('A24 / arthouse', 'Film & TV'),
  ('Korean dramas', 'Film & TV'),
  ('Documentaries', 'Film & TV'),
  ('Marvel / superhero', 'Film & TV'),
  ('Stand-up comedy', 'Film & TV'),
  ('Breaking Bad', 'Film & TV'),
  ('The Office', 'Film & TV'),

  -- Arts
  ('Painting & drawing', 'Arts'),
  ('Photography', 'Arts'),
  ('Film photography', 'Arts'),
  ('Music production', 'Arts'),
  ('DJing', 'Arts'),
  ('Creative writing', 'Arts'),
  ('Poetry', 'Arts'),
  ('Ceramics / pottery', 'Arts'),
  ('Knitting & sewing', 'Arts'),
  ('Woodworking', 'Arts'),

  -- Outdoors
  ('Hiking', 'Outdoors'),
  ('Rock climbing', 'Outdoors'),
  ('Camping', 'Outdoors'),
  ('Cycling', 'Outdoors'),
  ('Skiing / snowboarding', 'Outdoors'),
  ('Surfing', 'Outdoors'),
  ('Kayaking', 'Outdoors'),
  ('Backpacking', 'Outdoors'),
  ('Fishing', 'Outdoors'),
  ('Stargazing', 'Outdoors'),

  -- Ideas
  ('Coding / web dev', 'Ideas'),
  ('AI / machine learning', 'Ideas'),
  ('Startups / entrepreneurship', 'Ideas'),
  ('Robotics', 'Ideas'),
  ('Crypto / blockchain', 'Ideas'),
  ('Philosophy', 'Ideas'),
  ('Psychology', 'Ideas'),
  ('Space / astronomy', 'Ideas'),
  ('Economics', 'Ideas'),
  ('History', 'Ideas'),

  -- Community
  ('Volunteering', 'Community'),
  ('Debate / Model UN', 'Community'),
  ('Theater / acting', 'Community'),
  ('Improv', 'Community'),
  ('Dance', 'Community'),
  ('Campus journalism', 'Community'),
  ('Climate activism', 'Community'),
  ('Greek life', 'Community'),
  ('Religious groups', 'Community'),
  ('Cultural clubs', 'Community');

commit;
