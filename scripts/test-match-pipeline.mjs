/**
 * Dev-only end-to-end test for the match-users pipeline.
 *
 * What it does:
 *   1. Creates two test users (Alice + Bob) with the same hometown and
 *      a shared interest
 *   2. Inserts 3 location pings each at Brown University (41.8268, -71.4025)
 *      with timestamps spread 3 minutes apart so the persistence filter passes
 *   3. Invokes the match-users edge function as Alice
 *   4. Prints the edge function response and the resulting matches row
 *   5. Cleans up all test data
 *
 * Usage:
 *   node scripts/test-match-pipeline.mjs
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env (in addition to the existing
 * EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY).
 * Find your service role key at: Supabase dashboard → Settings → API.
 *
 * The edge function must be deployed before running:
 *   supabase functions deploy match-users
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Load .env ────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env');

try {
  // Parse .env manually — avoids needing dotenv as an explicit dep
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // No .env file — fall through to process.env
}

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY          = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing env vars. Add to your .env:\n' +
    '  EXPO_PUBLIC_SUPABASE_URL\n' +
    '  EXPO_PUBLIC_SUPABASE_ANON_KEY\n' +
    '  SUPABASE_SERVICE_ROLE_KEY   ← find in Supabase dashboard → Settings → API\n'
  );
  process.exit(1);
}

// Brown University — Providence, RI
const BROWN_LAT = 41.8268;
const BROWN_LNG = -71.4025;

const ALICE = { email: '__test_alice@brown.edu', password: 'Amici_Test_999!' };
const BOB   = { email: '__test_bob@brown.edu',   password: 'Amici_Test_999!' };
const TEST_INTEREST_LABEL = '__test_interest_amici__';

// Service-role client — bypasses RLS, used for setup and teardown
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Main ─────────────────────────────────────────────────────────────────────

let aliceId, bobId;

try {
  await cleanup();      // remove any leftovers from a previous run

  // ── 1. Create auth users ──────────────────────────────────────────────────
  console.log('\n── Creating test users ──');
  aliceId = await createUser(ALICE.email, ALICE.password, 'Alice');
  bobId   = await createUser(BOB.email,   BOB.password,   'Bob');
  console.log(`  Alice  ${aliceId}`);
  console.log(`  Bob    ${bobId}`);

  // ── 2. Set profiles (matching hometown) ───────────────────────────────────
  console.log('\n── Setting up profiles ──');
  await setProfile(aliceId);
  await setProfile(bobId);
  console.log('  hometown: Providence, RI  ✓');

  // ── 3. Shared interest ────────────────────────────────────────────────────
  console.log('\n── Setting up shared interest ──');
  const interestId = await upsertTestInterest();
  await must(admin.from('user_interests').insert([
    { user_id: aliceId, interest_id: interestId },
    { user_id: bobId,   interest_id: interestId },
  ]), 'assign interests');
  console.log(`  "${TEST_INTEREST_LABEL}"  ✓`);

  // ── 4. Active windows (all day, every day) ────────────────────────────────
  console.log('\n── Setting up active windows ──');
  await setupActiveWindows(aliceId);
  await setupActiveWindows(bobId);
  console.log('  Mon–Sun 00:00–23:59  ✓');

  // ── 5. Insert 3 location pings per user, backdated 3→1 minutes ───────────
  console.log('\n── Inserting location pings ──');
  const now = Date.now();
  for (let minsAgo = 3; minsAgo >= 1; minsAgo--) {
    const ts = new Date(now - minsAgo * 60_000).toISOString();
    await insertPing(aliceId, ts);
    await insertPing(bobId,   ts);
    console.log(`  T-${minsAgo}min  Alice ✓  Bob ✓`);
  }

  // ── 6. Sign in as Alice to get a valid JWT ────────────────────────────────
  console.log('\n── Signing in as Alice ──');
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInErr } =
    await anonClient.auth.signInWithPassword({ email: ALICE.email, password: ALICE.password });
  if (signInErr) throw new Error(`Sign-in failed: ${signInErr.message}`);
  const token = signIn.session.access_token;
  console.log('  OK');

  // ── 7. Invoke the edge function ───────────────────────────────────────────
  console.log('\n── Invoking match-users ──');
  const fnRes = await fetch(`${SUPABASE_URL}/functions/v1/match-users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': ANON_KEY,
    },
    body: JSON.stringify({ user_id: aliceId, lat: BROWN_LAT, lng: BROWN_LNG }),
  });

  let fnBody;
  try { fnBody = await fnRes.json(); } catch { fnBody = await fnRes.text(); }

  console.log(`  HTTP ${fnRes.status}`);
  console.log('  Response:', JSON.stringify(fnBody, null, 4));

  // ── 8. Show resulting matches rows ───────────────────────────────────────
  console.log('\n── matches table (rows for this pair) ──');
  const { data: matches, error: matchErr } = await admin
    .from('matches')
    .select('*')
    .or(`user_id_1.eq.${aliceId},user_id_2.eq.${aliceId}`);
  if (matchErr) throw new Error(`Read matches: ${matchErr.message}`);

  if (!matches?.length) {
    console.log('  (no rows — match did not fire)');
  } else {
    for (const m of matches) {
      console.log('\n  ' + JSON.stringify(m, null, 4).replace(/\n/g, '\n  '));
    }
  }

} finally {
  if (process.argv.includes('--keep')) {
    console.log('\n── Skipping cleanup (--keep) ──');
    console.log('  Run without --keep to auto-delete test data.\n');
  } else {
    // ── 9. Clean up ──────────────────────────────────────────────────────────
    console.log('\n── Cleaning up ──');
    await cleanup();
    console.log('  Done.\n');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createUser(email, password, firstName) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,                        // skip email OTP for test users
    user_metadata: { first_name: firstName },   // picked up by handle_new_user trigger
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function setProfile(userId) {
  await must(
    admin.from('users').update({ hometown_city: 'Providence', hometown_state: 'RI' }).eq('id', userId),
    'setProfile',
  );
}

async function upsertTestInterest() {
  const { data, error } = await admin
    .from('interests')
    .upsert({ label: TEST_INTEREST_LABEL, category: 'Test' }, { onConflict: 'label' })
    .select('id')
    .single();
  if (error) throw new Error(`upsertTestInterest: ${error.message}`);
  return data.id;
}

async function setupActiveWindows(userId) {
  const rows = Array.from({ length: 7 }, (_, day) => ({
    user_id: userId, day_of_week: day, start_time: '00:00:00', end_time: '23:59:59',
  }));
  await must(admin.from('active_windows').insert(rows), 'setupActiveWindows');
}

async function insertPing(userId, timestamp) {
  await must(
    admin.from('location_pings').insert({ user_id: userId, lat: BROWN_LAT, lng: BROWN_LNG, timestamp }),
    'insertPing',
  );
}

async function cleanup() {
  // Delete by email — cascade removes public.users, pings, windows, interests, matches
  for (const email of [ALICE.email, BOB.email]) {
    const { data } = await admin.auth.admin.listUsers();
    const user = data?.users?.find(u => u.email === email);
    if (user) {
      await admin.auth.admin.deleteUser(user.id);
      console.log(`  Deleted ${email}`);
    }
  }
  // Remove the test interest (not cascade-deleted with users)
  await admin.from('interests').delete().eq('label', TEST_INTEREST_LABEL);
}

// Throws on Supabase error so callers stay terse
async function must(promise, label) {
  const { error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
}
