// handle-share — Supabase Edge Function (idempotent)
//
// Called when a user submits their share preferences on the Share Screen,
// and re-called (triggered by a realtime event) to check revealed contact info.
//
//   1. Verify caller identity from JWT
//   2. Load connection — confirm caller is a participant
//   3. If caller hasn't submitted yet: persist choices + set shared_at_X
//   4. Reload connection to get latest state from both sides
//   5. If BOTH shared_at columns are set:
//      - Load the other user's contact info via service role (bypasses RLS)
//      - Filter by their share choices (shared_instagram_Y / shared_phone_Y)
//      - Return revealed contact info
//   6. Return { submitted, waiting, contact }
//
// SECURITY: Contact info is NEVER returned until both shared_at columns are
// non-null on the server. Clients cannot read instagram_handle / phone_number
// from the users table directly (the select RLS policy only covers safe fields).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req: Request): Promise<Response> => {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('Missing Authorization header', 401);

    let body: {
      connection_id: string;
      share_instagram: boolean;
      share_phone: boolean;
    };
    try { body = await req.json(); }
    catch { return err('Invalid JSON body', 400); }

    const { connection_id, share_instagram, share_phone } = body;
    if (!connection_id) return err('Required: connection_id', 400);
    if (typeof share_instagram !== 'boolean' || typeof share_phone !== 'boolean') {
      return err('Required: share_instagram (bool), share_phone (bool)', 400);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return err('Unauthorized', 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 2. Load connection ────────────────────────────────────────────────────
    const { data: conn, error: connErr } = await admin
      .from('connections')
      .select('id, user_id_1, user_id_2, shared_instagram_1, shared_instagram_2, shared_phone_1, shared_phone_2, shared_at_1, shared_at_2')
      .eq('id', connection_id)
      .single();

    if (connErr || !conn) return err('Connection not found', 404);

    const isUser1 = conn.user_id_1 === user.id;
    const isUser2 = conn.user_id_2 === user.id;
    if (!isUser1 && !isUser2) return err('Forbidden', 403);

    // ── 3. Persist choices if not yet submitted ───────────────────────────────
    const alreadySubmitted = isUser1 ? !!conn.shared_at_1 : !!conn.shared_at_2;

    if (!alreadySubmitted) {
      const patch = isUser1
        ? { shared_instagram_1: share_instagram, shared_phone_1: share_phone, shared_at_1: new Date().toISOString() }
        : { shared_instagram_2: share_instagram, shared_phone_2: share_phone, shared_at_2: new Date().toISOString() };

      const { error: patchErr } = await admin
        .from('connections')
        .update(patch)
        .eq('id', connection_id);

      if (patchErr) throw patchErr;
    }

    // ── 4. Reload connection to get latest from both sides ────────────────────
    const { data: fresh, error: freshErr } = await admin
      .from('connections')
      .select('shared_instagram_1, shared_instagram_2, shared_phone_1, shared_phone_2, shared_at_1, shared_at_2')
      .eq('id', connection_id)
      .single();

    if (freshErr || !fresh) throw freshErr ?? new Error('Reload failed');

    const bothSubmitted = !!fresh.shared_at_1 && !!fresh.shared_at_2;

    // ── 5. Reveal contact info only when both sides have submitted ─────────────
    if (bothSubmitted) {
      const otherId = isUser1 ? conn.user_id_2 : conn.user_id_1;
      const otherSharedInstagram = isUser1 ? fresh.shared_instagram_2 : fresh.shared_instagram_1;
      const otherSharedPhone     = isUser1 ? fresh.shared_phone_2     : fresh.shared_phone_1;

      const { data: otherUser, error: userErr } = await admin
        .from('users')
        .select('instagram_handle, phone_number')
        .eq('id', otherId)
        .single();

      if (userErr || !otherUser) throw userErr ?? new Error('User lookup failed');

      const contact = {
        instagram_handle: otherSharedInstagram ? otherUser.instagram_handle : null,
        phone_number:     otherSharedPhone     ? otherUser.phone_number     : null,
      };

      console.log(`[share] Both submitted for conn ${connection_id} | caller ${user.id}`);
      return ok({ submitted: true, waiting: false, contact });
    }

    // Other user hasn't submitted yet
    console.log(`[share] Saved choices for conn ${connection_id} | caller ${user.id} | waiting for other`);
    return ok({ submitted: true, waiting: true, contact: null });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[share] Unhandled error:', message);
    return err(message, 500);
  }
});

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
