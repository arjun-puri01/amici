// match-users — Supabase Edge Function
//
// Invoked by the mobile app immediately after each location_pings insert.
// Runs the full server-side matching pipeline for the caller:
//
//   1. Verify caller identity from JWT
//   2. Guard: caller must be inside their active window
//   3. Guard: caller must not be inside their dorm exclusion zone
//   4. Find nearby users who share a trigger and haven't matched today
//   5. Apply 3-minute persistence filter (both users must have 3+ pings
//      within 50 m of each other — ~3 minutes at 1 ping/min cadence)
//   6. Insert match record for each qualifying pair
//   7. Send push notifications to both users via Expo Push API

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MATCH_RADIUS_METERS   = 50;  // meters — must be within this to qualify
const LOOKBACK_MINUTES      = 5;   // how far back to look for recent pings
const MIN_PERSISTENCE_PINGS = 3;   // both users need this many pings nearby

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ─── Handler ─────────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  try {
    // ── 1. Parse and validate request ────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('Missing Authorization header', 401);

    let body: { user_id: string; lat: number; lng: number };
    try {
      body = await req.json();
    } catch {
      return err('Invalid JSON body', 400);
    }

    const { user_id, lat, lng } = body;
    if (!user_id || lat == null || lng == null) {
      return err('Required fields: user_id, lat, lng', 400);
    }

    // ── 2. Verify the JWT belongs to the claimed user ────────────────────────
    // Use the anon-key client so the JWT is actually validated (service role
    // would skip JWT verification entirely).
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user || user.id !== user_id) {
      return err('Unauthorized', 401);
    }

    // Service-role client bypasses RLS for cross-user matching queries.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 3. Fetch caller's display info (needed for notification to user B) ───
    const { data: callerInfo, error: callerErr } = await admin
      .from('users')
      .select('first_name, profile_photo_url, expo_push_token')
      .eq('id', user_id)
      .single();
    if (callerErr) throw callerErr;

    // ── 4. Guard: active window ───────────────────────────────────────────────
    // Server-side re-check even though the client guards this too; the client
    // check is a battery-saving optimisation, not a security boundary.
    const { data: inWindow, error: windowErr } = await admin.rpc('is_in_active_window', {
      target_user_id: user_id,
    });
    if (windowErr) throw windowErr;
    if (!inWindow) {
      return ok({ matched: false, reason: 'outside_active_window' });
    }

    // ── 5. Guard: dorm exclusion zone ────────────────────────────────────────
    const { data: inDorm, error: dormErr } = await admin.rpc('is_in_dorm_zone', {
      target_user_id: user_id,
      ref_lat: lat,
      ref_lng: lng,
    });
    if (dormErr) throw dormErr;
    if (inDorm) {
      return ok({ matched: false, reason: 'in_dorm_zone' });
    }

    // ── 6. Find nearby candidates ─────────────────────────────────────────────
    const { data: candidates, error: candidateErr } = await admin.rpc('find_nearby_candidates', {
      caller_id:    user_id,
      caller_lat:   lat,
      caller_lng:   lng,
      radius_m:     MATCH_RADIUS_METERS,
      lookback_min: LOOKBACK_MINUTES,
    });
    if (candidateErr) throw candidateErr;

    if (!candidates || candidates.length === 0) {
      return ok({ matched: false, reason: 'no_candidates' });
    }

    // ── 7. Persistence filter + match creation + notifications ────────────────
    const firedPairs: string[] = [];

    for (const candidate of candidates) {
      // Skip if the trigger value couldn't be resolved (shouldn't happen, but
      // guard against a malformed shared_interests join producing null).
      if (!candidate.trigger_value) {
        console.warn(`[match] Skipping ${candidate.user_id} — null trigger_value`);
        continue;
      }

      // B must have been within MATCH_RADIUS_METERS of A's current location
      // for at least MIN_PERSISTENCE_PINGS consecutive minutes.
      const { data: bNearA, error: bErr } = await admin.rpc('count_pings_near_point', {
        target_user_id: candidate.user_id,
        ref_lat:        lat,
        ref_lng:        lng,
        radius_m:       MATCH_RADIUS_METERS,
        lookback_min:   LOOKBACK_MINUTES,
        max_pings:      MIN_PERSISTENCE_PINGS,
      });
      if (bErr) { console.warn('[match] count_pings_near_point (B→A):', bErr.message); continue; }

      // A must have been within MATCH_RADIUS_METERS of B's latest location
      // for the same minimum duration (checked symmetrically).
      const { data: aNearB, error: aErr } = await admin.rpc('count_pings_near_point', {
        target_user_id: user_id,
        ref_lat:        candidate.b_lat,
        ref_lng:        candidate.b_lng,
        radius_m:       MATCH_RADIUS_METERS,
        lookback_min:   LOOKBACK_MINUTES,
        max_pings:      MIN_PERSISTENCE_PINGS,
      });
      if (aErr) { console.warn('[match] count_pings_near_point (A→B):', aErr.message); continue; }

      if ((bNearA ?? 0) < MIN_PERSISTENCE_PINGS || (aNearB ?? 0) < MIN_PERSISTENCE_PINGS) {
        // One or both users haven't been nearby long enough yet.
        continue;
      }

      // ── Insert match record, capturing the generated ID ───────────────────
      // user_id_1 is always the user whose ping triggered this invocation.
      // If both users ping simultaneously and both pass, the NOT EXISTS in
      // find_nearby_candidates will prevent a second match record after the
      // first one lands (eventual consistency; acceptable for MVP).
      const { data: matchRow, error: insertErr } = await admin
        .from('matches')
        .insert({
          user_id_1:     user_id,
          user_id_2:     candidate.user_id,
          trigger_type:  candidate.trigger_type,
          trigger_value: candidate.trigger_value,
          status:        'pending',
        })
        .select('id')
        .single();

      if (insertErr) {
        // Most likely cause: a simultaneous ping from user B already inserted
        // the reverse match. Log and continue rather than returning an error.
        console.warn(
          `[match] Insert failed for ${user_id} ↔ ${candidate.user_id}:`,
          insertErr.message,
        );
        continue;
      }

      firedPairs.push(candidate.user_id);
      console.log(
        `[match] Fired: ${user_id} ↔ ${candidate.user_id}` +
        ` | ${candidate.trigger_type}: "${candidate.trigger_value}"`,
      );

      // ── Fetch user B's push token ─────────────────────────────────────────
      const { data: candidateTokenRow } = await admin
        .from('users')
        .select('expo_push_token')
        .eq('id', candidate.user_id)
        .single();

      // ── Send push notifications to both users simultaneously ──────────────
      const triggerText = candidate.trigger_type === 'hometown'
        ? `You're both from ${candidate.trigger_value}`
        : `You both love ${candidate.trigger_value}`;

      // Shared data payload — used by the Match Screen (step 7) on tap.
      // Profile photos are in the data payload; in-notification images require
      // a native Notification Service Extension (out of scope for MVP).
      const sharedData = {
        matchId:      matchRow.id,
        triggerType:  candidate.trigger_type,
        triggerValue: candidate.trigger_value,
      };

      const messages = [];

      // Notification for user A about user B
      if (callerInfo?.expo_push_token) {
        messages.push({
          to:    callerInfo.expo_push_token,
          title: candidate.first_name,
          body:  `${triggerText}. Look for ${candidate.first_name}!`,
          sound: 'default',
          data:  {
            ...sharedData,
            otherUserId:   candidate.user_id,
            otherUserName: candidate.first_name,
            otherUserPhoto: candidate.profile_photo_url,
          },
        });
      }

      // Notification for user B about user A
      if (candidateTokenRow?.expo_push_token) {
        messages.push({
          to:    candidateTokenRow.expo_push_token,
          title: callerInfo?.first_name ?? 'Someone',
          body:  `${triggerText}. Look for ${callerInfo?.first_name ?? 'them'}!`,
          sound: 'default',
          data:  {
            ...sharedData,
            otherUserId:   user_id,
            otherUserName: callerInfo?.first_name,
            otherUserPhoto: callerInfo?.profile_photo_url,
          },
        });
      }

      if (messages.length > 0) {
        await sendPushNotifications(messages);
      } else {
        console.log('[push] No push tokens available for this pair — skipping notifications');
      }
    }

    return ok({ matched: firedPairs.length > 0, pairs: firedPairs });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[match] Unhandled error:', message);
    return err(message, 500);
  }
});

// ─── Push helpers ─────────────────────────────────────────────────────────────

// Sends one or more messages to the Expo Push API in a single batched request.
// Logs per-message errors (e.g. invalid token, unregistered device) without
// throwing — a push delivery failure must never abort the match creation.
async function sendPushNotifications(messages: object[]): Promise<void> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      console.warn('[push] Expo API HTTP error:', res.status, await res.text());
      return;
    }

    const json = await res.json() as { data: Array<{ status: string; message?: string }> };
    for (let i = 0; i < json.data.length; i++) {
      const ticket = json.data[i];
      if (ticket.status !== 'ok') {
        console.warn(`[push] Delivery failed for message ${i}:`, ticket.message);
      } else {
        console.log(`[push] Delivered message ${i}`);
      }
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.warn('[push] sendPushNotifications error:', message);
  }
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
