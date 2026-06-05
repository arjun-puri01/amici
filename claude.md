# Campus Proximity App — Claude Code Context

## Critical Working Rule
Build ONE step from the MVP order at a time. Stop after each step and wait for review before proceeding. Do not build ahead.

## Spec
Full product spec is in app_spec.md in this repo. Read it fully before starting. Check which MVP step we are on before doing anything.

## Stack
- React Native with Expo (TypeScript)
- Expo Location for background location
- Expo Notifications for push notifications
- React Navigation for routing
- Supabase for database, auth, real-time, and edge functions
- Supabase PostGIS for geospatial queries
- iOS only — no Android

## Project Structure
Maintain this structure exactly:
```
/app
  /screens
  /components
  /hooks
  /lib
    supabase.ts
  /types
    index.ts
/supabase
  /functions
    /match-users
/assets
CLAUDE.md
app_spec.md
```

## First Thing To Do In Any Session
1. Read app_spec.md
2. Read this file
3. Check /app/types/index.ts — if it doesn't exist, create it first with all data models from the spec before touching anything else
4. Ask which MVP step we are on if not told

## Conventions
- TypeScript throughout, no plain JS
- Define all types in /app/types/index.ts before using them anywhere
- Comment all Supabase edge functions thoroughly
- Every Supabase call needs proper error handling and user-facing feedback
- Every location permission request needs proper error handling
- Ask before adding any feature not described in app_spec.md
- Never expose contact info (Instagram, phone) in any client-side state before mutual server-side confirmation is complete

## Flag For Real Device Testing
Always flag anything that requires a real device rather than simulator. Specifically:
- Background location behavior
- Push notification delivery
- APNs integration
Do not assume these work correctly in simulator.

## Key Decisions (do not change without asking)
- Active windows only — no always-on location tracking
- 3 minute persistence filter before a match notification fires
- Both users notified simultaneously — neither knows who was notified first
- Dorm exclusion zone: 100 meter radius, set by user during onboarding
- Match fires once per pair per 24 hours maximum
- .edu email verification only
- All triggers (hometown, interests) are equal — no trigger type is prioritized over another
- Hardcoded to Brown University, Providence RI for MVP

## What Not To Build
- Any social feed or public profile browsing
- In-app messaging
- Android version
- Multi-school support
- Monetization or advertising layer
- Anything not in app_spec.md