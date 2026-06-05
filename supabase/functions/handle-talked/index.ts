// handle-talked — Supabase Edge Function
//
// Called when a user taps "We Talked" on the Match Screen.
//
//   1. Verify caller identity from JWT
//   2. Load the match and confirm the caller is a participant
//   3. Confirm the match is still in 'pending' state
//   4. Update: status → 'talked', talked_by_user_id → caller
//   5. Look up the other user's push token and first name
//   6. Send "[CallerName] wants to connect." notification to the other user

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL               = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL              = 'https://exp.host/--/api/v2/push/send';

serve(async (req: Request): Promise<Response> => {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('Missing Authorization header', 401);

    let body: { match_id: string };
    try { body = await req.json(); }
    catch { return err('Invalid JSON body', 400); }

    const { match_id } = body;
    if (!match_id) return err('Required: match_id', 400);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return err('Unauthorized', 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 2. Load match ─────────────────────────────────────────────────────────
    const { data: match, error: matchErr } = await admin
      .from('matches')
      .select('id, user_id_1, user_id_2, trigger_type, trigger_value, status')
      .eq('id', match_id)
      .single();

    if (matchErr || !match) return err('Match not found', 404);

    // Verify caller participates in this match
    if (match.user_id_1 !== user.id && match.user_id_2 !== user.id) {
      return err('Forbidden', 403);
    }

    // ── 3. Guard: only pending matches can be acted on ────────────────────────
    if (match.status !== 'pending') {
      return err(`Match is already '${match.status}'`, 409);
    }

    // ── 4. Update match ───────────────────────────────────────────────────────
    const { error: updateErr } = await admin
      .from('matches')
      .update({ status: 'talked', talked_by_user_id: user.id })
      .eq('id', match_id);

    if (updateErr) throw updateErr;

    // ── 5. Look up both users for the notification ────────────────────────────
    const otherId = match.user_id_1 === user.id ? match.user_id_2 : match.user_id_1;

    const { data: users } = await admin
      .from('users')
      .select('id, first_name, expo_push_token')
      .in('id', [user.id, otherId]);

    const caller    = users?.find(u => u.id === user.id);
    const otherUser = users?.find(u => u.id === otherId);

    // ── 6. Push notification to the other user ────────────────────────────────
    // Spec: "a notification is sent to the other person: '[Name] wants to connect.'"
    if (otherUser?.expo_push_token) {
      await sendPush({
        to:    otherUser.expo_push_token,
        title: caller?.first_name ?? 'Someone',
        body:  `${caller?.first_name ?? 'Someone'} wants to connect.`,
        sound: 'default',
        data:  { matchId: match_id, type: 'talked' },
      });
    } else {
      console.log(`[talked] No push token for ${otherId} — skipping notification`);
    }

    console.log(`[talked] ${user.id} → ${otherId} | match ${match_id}`);
    return ok({ success: true });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[talked] Unhandled error:', message);
    return err(message, 500);
  }
});

async function sendPush(message: object): Promise<void> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(message),
    });
    if (!res.ok) console.warn('[talked/push] HTTP error:', res.status, await res.text());
  } catch (e: unknown) {
    console.warn('[talked/push] fetch error:', e instanceof Error ? e.message : e);
  }
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

function err(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
