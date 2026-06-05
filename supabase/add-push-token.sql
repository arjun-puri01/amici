-- Migration: add Expo push token storage
-- Run in Supabase SQL editor after schema.sql

alter table public.users
  add column if not exists expo_push_token text;
