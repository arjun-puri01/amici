# Amici — Progress Log

Context handoff for future Claude Code sessions. Last updated: 2026-06-20.

Read this alongside `CLAUDE.md` (working rules) and `app_spec.md` (full product spec).

## What this app is
A passive, opt-in iOS app for college students (hardcoded to Brown University for MVP). During user-set active windows it runs low-frequency background location and notifies two users when they've been within ~50m of each other for 3+ minutes AND share a trigger (same hometown OR a niche interest). Users then meet in person and can optionally exchange contact info via a mutual confirmation flow. Calm, ambient, minimal, dark mode. The notification is the hero moment.

## Overall status
**All 10 MVP steps are code-complete.** The app is in the testing/polish phase: verifying Supabase configuration and behavior on a real device, and fixing bugs found during testing. No new features should be built without asking (see CLAUDE.md "What Not To Build").

## MVP step status
| # | Step | Status | Notes |
|---|------|--------|-------|
| 1 | Auth + onboarding | Done | `.edu` validation, full onboarding stack |
| 2 | Profile setup | Done | Photo, hometown, interests, grad year |
| 3 | Active window setup | Done | Built in onboarding; editable in Profile |
| 4 | Background location ping | Done | `useLocationTracking.ts`, `backgroundTask.ts` — needs real-device verification |
| 5 | Matching edge function | Done | `supabase/functions/match-users` + `functions.sql` |
| 6 | Push notification delivery | Done | Expo push / APNs — needs real-device verification |
| 7 | Match screen + "We talked" | Done | `MatchScreen.tsx`, `handle-talked` function |
| 8 | Mutual confirmation + Share | Done | `ShareScreen.tsx`, `handle-confirm`/`handle-share` functions |
| 9 | History screen | Done | `HistoryScreen.tsx`, filterable |
| 10 | Dorm exclusion zone | Done | Hardcoded approach — see Key deviations below |

## Project structure (actual)
```
/app
  Navigation.tsx            root navigator (auth → onboarding → main)
  /screens/auth             SignIn, SignUp, Onboarding{Photo,GradYear,Hometown,Interests,Windows,Contact}
  /screens/main             Home, History, Match, Profile, Share
  /hooks                    useLocationTracking, usePushToken
  /lib                      supabase, AuthContext, backgroundTask, interests, theme
  /types/index.ts           all data models
/supabase
  schema.sql                base schema (PostGIS, RLS, triggers)
  functions.sql             SQL helper fns for matching (step 5)
  add-push-token.sql        push token column (step 6)
  add-match-screen-support.sql
  add-connections-tracking.sql
  add-history-rls.sql
  add-brown-dorm-zones.sql  hardcoded Brown dorm zones (step 10)
  /functions                match-users, handle-talked, handle-confirm, handle-share (Deno edge fns)
app_spec.md, CLAUDE.md, progress.md
```
Note: `npx tsc --noEmit` reports errors only in `supabase/functions/**` — these are expected (Deno URL imports + `Deno` global, different runtime) and are NOT app bugs. The app (`app/**`) typechecks clean.

## Key deviations from the original spec
- **Dorm exclusion (step 10):** Spec called for a per-user map picker at a 100m radius. Built instead as a **system-wide hardcoded set of 36 Brown dorm buildings at 50m radius each** (`brown_dorm_zones`), checked in `is_in_dorm_zone()` and `find_nearby_candidates()`. The per-user `dorm_exclusion_zones` table still exists and is also checked, but has no onboarding UI. app_spec.md has been updated to reflect this. NOTE: CLAUDE.md "Key Decisions" still says "100 meter radius, set by user during onboarding" — that line is stale but is under a "do not change without asking" heading, so confirm with the user before editing it.

## Recent fixes (testing phase)
- **Keyboard avoidance:** ProfileScreen and OnboardingContactScreen wrap their form in `KeyboardAvoidingView` (`behavior="padding"` on iOS) with `keyboardShouldPersistTaps="handled"` so focused inputs (esp. phone, lowest on screen) sit above the keyboard.
- **Profile photo uploading as 0 bytes / black image:** Root cause was empty uploads — `fetch().blob()`, `fetch().arrayBuffer()`, and `new File(uri).bytes()` all return empty data for `file://` URIs in this RN/Expo environment. **Fix (both upload paths, now identical):** read via `readAsStringAsync(uri, { encoding: EncodingType.Base64 })` from `expo-file-system/legacy`, decode with `decode` from `base64-arraybuffer`, upload the resulting ArrayBuffer, with a `byteLength === 0` guard that throws before upload. MIME also corrected from `image/jpg` to `image/jpeg`. Added dependency: `base64-arraybuffer`. Paths: `app/screens/auth/OnboardingPhotoScreen.tsx`, `app/screens/main/ProfileScreen.tsx`. After pulling, run `yarn start --clear` so Metro picks up the new dep.

## Required Supabase / device config (must be done outside the codebase)
1. `.env` from `.env.example` with real Supabase URL + anon key
2. Run in Supabase SQL editor, in order: `schema.sql`, `functions.sql`, `add-push-token.sql`, and the other `add-*.sql` migrations (incl. `add-brown-dorm-zones.sql`)
3. Enable the PostGIS extension
4. Create a public `profile-photos` storage bucket
5. Add notification icon at `assets/notification-icon.png`
6. Deploy edge functions: `supabase functions deploy match-users` (and the other functions)
7. Push token registration + background location + APNs require a **real device** — they do not work in the simulator

## How to run
- `yarn start` runs `expo start --dev-client` (with Watchman disabled). This project uses native modules (background location, notifications) that do NOT work in Expo Go — a custom dev client build is required.
- After native changes or new native deps: rebuild with `yarn ios` (`expo run:ios`).
- After a new JS dependency: `yarn start --clear` to reset Metro cache.

## What's likely next
Real-device testing of the location/match/notification pipeline, plus any bugs the user surfaces. Confirm with the user before starting any new step or feature.
