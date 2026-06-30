App Spec: Campus Proximity Connection App
This document is a product specification for Claude Code. Build exactly what is described. Ask for clarification before deviating from any decision made here.
What This App Is
A passive, opt-in iOS app forå college students that notifies you when someone nearby shares a meaningful connection trigger with you. When you get a notification, you find the person, talk to them, and can exchange contact info through a simple mutual confirmation flow. It runs quietly in the background during windows you set. It does not require active use to create value.
The Core Problem It Solves
College students frequently share meaningful things in common with people physically near them — same hometown, same niche interest — and never find out. The app surfaces these moments passively so that serendipitous connections that would otherwise never happen, do.
The Full User Flow
Onboarding
User signs up with their .edu email (college verification)
User uploads a profile photo
User enters their graduation year
User enters their hometown (city, state)
User adds niche interests from a curated list (no max, but a long list) — these are specific, not generic. Examples: F1, chess, a specific music genre, a sport, a TV show category. NOT "music" or "sports"
User sets their active windows — time blocks during which the app is allowed to run background location. Example: Mon-Fri 10am-6pm. Outside these windows the app does nothing and uses no battery. Default should be a large window like Mon-Sun, 10am - 10pm. That way, the default encourages lots of connection.
User optionally adds Instagram handle and/or phone number. These are stored server-side and are NEVER shared without explicit mutual confirmation
Background Behavior
During active windows, the app runs background location at low frequency (every 1 minute, not continuous)
Every location ping, the app queries the backend: are any other active users within X meters (configurable, default 50 meters) who share at least one trigger with me?
A trigger is: same hometown OR same niche interest
The match must persist for at least 3 minutes before a notification fires (both users must have been nearby for 3+ minutes — this filters out people just walking past)
Dorms are excluded from matching (too many people in a small space creates false positives). IMPLEMENTED AS: a system-wide hardcoded set of Brown University dorm building locations (36 buildings, 50 meter exclusion radius each) stored in the brown_dorm_zones table — no per-user map setup during onboarding. The per-user dorm_exclusion_zones table still exists and is also checked as a supplementary personal zone, but there is no onboarding UI to populate it; for the Brown MVP the hardcoded campus zones cover all dorms. (Original spec called for a user-set map location with a 100 meter radius; this was changed during implementation to remove onboarding friction and guarantee coverage.)
Matches only fire once per pair per 24 hours. If a match has been “acted upon” (see below, We Talked) then the match should never fire again.
The Notification
When a match fires, both users get a push notification simultaneously. The notification shows:
The person's first name
Their profile photo (small)
The shared trigger ("You're both from Austin, TX" or "You both love F1")
The text: "Look for ___!"
Tapping the notification opens the app to the Match Screen
The Match Screen
Shows the matched person's photo, name, graduation year, and the shared trigger
A subtle animated pulse to convey "they're still nearby"
Two buttons: "We talked" and "Skip" Notification is present for a few minutes and then disappears at which point the Skip is assumed. 
If the user taps Skip, nothing happens. The match is logged to history as a near-miss
If the user taps "We talked", a notification is sent to the other person: "[Name] wants to connect.” 
The Mutual Confirmation Flow
The other person opens the app and sees the same Match Screen with a prompt: "[Name] says you talked — confirm?"
They tap "Yes we did" or "Nope"
If they tap Nope, nothing happens. Logged as near-miss
If they tap Yes, both users are shown a Share Screen
The Share Screen
Shown to both users simultaneously
Header: "What do you want to share with [Name]?"
Toggle options:
Instagram handle (shown only if they added one)
Phone number (shown only if they added one)
Nothing (always available)
Each user independently selects what to share
Both tap "Send"
The app exchanges only what each person chose to share
Confirmation screen: "[Name] shared their Instagram with you: @handle" etc.
Both users are now in each other's Connections history
This only occurs if We Talked is pressed on both ends.
The History Screen
Shows a reverse-chronological log of all matches. Each entry shows:
Person's photo, name, shared trigger
Date and time of match
If connected: what was shared
A subtle note if you've matched with the same person multiple times: "You've crossed paths 3 times"
Screens (3 total)
1. Home / Active Screen
Shows current status: active window on/off
Toggle to manually turn active mode on or off for the current session
Shows a subtle map or ambient visual indicating "listening" state
Shows count of connections made
History screen
Full log as described above
Filterable by: Near-misses, Talked, Connected
Connections appear beneath the main content of home screen
3. Profile Screen
Edit photo, hometown, interests, graduation year
Edit active windows
Edit contact info (Instagram, phone)
Edit dorm exclusion zone
Accessible through a favicon in the top right—should not occupy much real estate on the screen
4. Match Screen (modal, appears on notification tap)
As described above in the flow
After a match screen appears, there should be a “minimize” button, and then after the match is acted upon (or the match times out) the match should disappear and not be accessible anymore
Tech Stack
Frontend
React Native with Expo
Use Expo Location for background location
Use Expo Notifications for push notifications
Navigation: React Navigation
Styling: keep it clean, minimal, dark mode by default
Backend
Supabase for database, auth, and real-time
Use Supabase's PostGIS extension for geospatial queries (finding users within X meters)
Supabase Edge Functions for the matching logic (runs server-side on every location ping)
Expo Push Notification Service wrapping Apple APNs for notifications
Data Models
users
id, email, first_name, profile_photo_url, graduation_year, hometown_city, hometown_state, instagram_handle (nullable), phone_number (nullable), created_at
interests
id, label (e.g. "F1 Racing"), category
user_interests
user_id, interest_id
active_windows
id, user_id, day_of_week (0-6), start_time, end_time
location_pings
id, user_id, lat, lng, timestamp
Delete pings older than 24 hours for privacy
matches
id, user_id_1, user_id_2, trigger_type (hometown | interest), trigger_value, fired_at, status (pending | talked | connected | missed)
connections
id, match_id, user_id_1, user_id_2, shared_instagram_1 (bool), shared_instagram_2 (bool), shared_phone_1 (bool), shared_phone_2 (bool), connected_at
dorm_exclusion_zones
id, user_id, lat, lng, radius_meters (default 100)

Matching Logic (runs server-side in Supabase Edge Function)
On location ping from user A:
1. Check if current time falls within user A's active windows. If not, ignore.
2. Check if user A's location is within their dorm exclusion zone. If yes, ignore.
3. Query all other users who:
   a. Have pinged within the last 5 minutes
   b. Are within 50 meters of user A
   c. Are in their own active window
   d. Are NOT in their own dorm exclusion zone
   e. Share at least one trigger with user A (same hometown city+state OR shared interest)
   f. Have NOT already been matched with user A in the last 24 hours
4. For each candidate user B:
   a. Check if user A and user B have BOTH been within 50m of each other for at least 3 minutes (compare last 3 location pings)
   b. If yes, fire match: create match record, send push notification to both

Key Design Decisions (do not change without asking)
Opt-in active windows only — the app NEVER runs location outside the user's set windows. This is the primary trust mechanism
Dorm exclusion — prevents notification spam in high-density living situations
3-minute persistence filter — prevents matches for people just walking past
Simultaneous notification — both users are notified at the same time. Neither person knows the other was notified first. This removes the one-sided awareness problem
Mutual confirmation required for contact share — contact info is NEVER shared unilaterally. Both must confirm
Each user controls what they share independently — user A can share Instagram, user B can share nothing. That's fine
.edu email verification — keeps it campus-only and verified
Match fires once per pair per 24 hours — prevents notification spam if two people are in the same class every day
What To Build First (MVP order)
Auth flow (email signup with .edu validation, onboarding screens)
Profile setup (photo, hometown, interests, graduation year)
Active window setup
Background location ping to Supabase
Matching edge function
Push notification delivery
Match screen + We Talked flow
Mutual confirmation + Share screen
History screen
Dorm exclusion zone setup
What NOT To Build Yet
Any social feed or public profile browsing
Messaging within the app (use Instagram/phone for that)
Any matching based on appearance or anything other than hometown and interests
Any advertising or monetization layer
Android version (iOS only for now)
Multi-school support (single school for MVP — hardcode Brown University, Providence RI)
Tone and Feel
This app should feel warm, ambient, and slightly magical — like it's quietly working for you in the background. Not gamified, not anxious, not swipe-heavy. The design should be calm. Dark mode default. Minimal UI. The notification is the hero moment, not the app itself. Should be uncomplicated with minimal input from users. Frictionless is best.
Notes for Claude Code
Ask before adding any feature not described here
The matching logic is the most critical piece — get it right before building UI
Test the background location behavior on a real device, not just simulator
Use TypeScript throughout
Comment the matching edge function thoroughly
The contact info (Instagram, phone) must NEVER appear in any client-side state until after mutual confirmation is complete on the server
Simpler code is better. Avoid overly lengthy functions with several helpers if a simpler function will do. Keep the design minimalist and refrain from using emojis everywhere. 

Claude.md

# Campus Proximity App — Claude Code Context

## Stack
- React Native with Expo (TypeScript)
- Expo Location for background location
- Expo Notifications for push notifications
- React Navigation for routing
- Supabase for database, auth, real-time, and edge functions
- Supabase PostGIS for geospatial queries
- iOS only — no Android

## Conventions
- TypeScript throughout, no plain JS
- Comment all edge functions thoroughly
- Ask before adding any feature not in the spec
- Never expose contact info (Instagram, phone) client-side before mutual server-side confirmation

## Current MVP Stage
Check app_spec.md for full spec and MVP build order. Always check which step we're on before starting work.

## Key Decisions (do not change)
- Active windows only — no always-on location
- 3 minute persistence filter before match fires
- Simultaneous notification to both users
- Dorm exclusion zone radius: 100 meters
- Match fires once per pair per 24 hours and never again if the match is acted positively upon
- .edu email verification only
- Hardcoded to Brown University for MVP

