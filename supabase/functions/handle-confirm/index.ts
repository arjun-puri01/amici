// handle-confirm — Supabase Edge Function
//
// Called when the non-initiating user taps "Yes we did" on the Match Screen.
//
//   1. Verify caller identity from JWT
//   2. Load the match — confirm it's 'talked' and caller is NOT the initiator
//   3. Update match: status → 'connected'
//   4. Create a connections row (share choices all false by default)
//   5. Push "[Name] confirmed! Share your contact info." to the initiating user
//   6. Return { connection_id } so both clients can navigate to ShareScreen

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL             = 'https://exp.host/--/api/v2/push/send';

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
      .select('id, user_id_1, user_id_2, status, talked_by_user_id')
      .eq('id', match_id)
      .single();

    if (matchErr || !match) return err('Match not found', 404);

    if (match.user_id_1 !== user.id && match.user_id_2 !== user.id) {
      return err('Forbidden', 403);
    }

    if (match.status !== 'talked') {
      return err(`Match is already '${match.status}'`, 409);
    }

    // Only the non-initiating user (responder) calls this endpoint
    if (match.talked_by_user_id === user.id) {
      return err('You initiated this conversation — wait for the other person to confirm', 409);
    }

    // ── 3. Transition match to connected ──────────────────────────────────────
    const { error: updateErr } = await admin
      .from('matches')
      .update({ status: 'connected' })
      .eq('id', match_id);

    if (updateErr) throw updateErr;

    // ── 4. Create connections row ─────────────────────────────────────────────
    // user_id_1 = initiator (talked_by_user_id), user_id_2 = responder (caller)
    const initiatorId  = match.talked_by_user_id!;
    const responderId  = user.id;

    const { data: conn, error: connErr } = await admin
      .from('connections')
      .insert({
        match_id,
        user_id_1: initiatorId,
        user_id_2: responderId,
      })
      .select('id')
      .single();

    if (connErr || !conn) throw connErr ?? new Error('Failed to create connection');

    // ── 5. Push notification to the initiating user ───────────────────────────
    const { data: users } = await admin
      .from('users')
      .select('id, first_name, expo_push_token')
      .in('id', [initiatorId, responderId]);

    const initiator = users?.find(u => u.id === initiatorId);
    const responder = users?.find(u => u.id === responderId);

    if (initiator?.expo_push_token) {
      await sendPush({
        to:    initiator.expo_push_token,
        title: responder?.first_name ?? 'Someone',
        body:  `${responder?.first_name ?? 'Someone'} confirmed! Now share your contact info.`,
        sound: 'default',
        data:  { matchId: match_id, connectionId: conn.id, type: 'confirmed' },
      });
    } else {
      console.log(`[confirm] No push token for initiator ${initiatorId} — skipping`);
    }

    console.log(`[confirm] ${responderId} confirmed | match ${match_id} | conn ${conn.id}`);
    return ok({ connection_id: conn.id });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[confirm] Unhandled error:', message);
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
    if (!res.ok) console.warn('[confirm/push] HTTP error:', res.status, await res.text());
  } catch (e: unknown) {
    console.warn('[confirm/push] fetch error:', e instanceof Error ? e.message : e);
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
