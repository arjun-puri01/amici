/**
 * Creates three test matches for your real app account, one in each
 * MatchScreen state:
 *
 *   1. pending         — shows photo, trigger, countdown, We Talked / Skip
 *   2. talked / me     — shows "Message sent, waiting for confirmation"
 *   3. talked / them   — shows the confirmation placeholder (step 8)
 *
 * Usage:
 *   node scripts/create-dev-match.mjs
 *
 * Requires REAL_USER_EMAIL in .env (your actual app account).
 * Run `supabase/add-match-screen-support.sql` first so the
 * talked_by_user_id column exists.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Load .env ────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env');

try {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
} catch { /* no .env — fall through to process.env */ }

const SUPABASE_URL     = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY         = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REAL_USER_EMAIL  = process.env.REAL_USER_EMAIL;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
if (!REAL_USER_EMAIL) {
  console.error('Add REAL_USER_EMAIL=you@brown.edu to your .env (your actual app account email)');
  process.exit(1);
}

const PARTNER_EMAIL    = '__dev_match_partner@brown.edu';
const PARTNER_PASSWORD = 'DevMatch_999!';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Main ─────────────────────────────────────────────────────────────────────

try {
  // ── 1. Find real user ─────────────────────────────────────────────────────
  console.log(`\n── Finding ${REAL_USER_EMAIL} ──`);
  const { data: { users: allUsers } } = await admin.auth.admin.listUsers();
  const realUser = allUsers.find(u => u.email === REAL_USER_EMAIL);
  if (!realUser) {
    console.error(`  Not found. Sign up in the app first with ${REAL_USER_EMAIL}`);
    process.exit(1);
  }
  console.log(`  Found: ${realUser.id}`);

  // ── 2. Clean up any leftover partner + dev matches ────────────────────────
  console.log('\n── Cleaning up old dev matches ──');
  const oldPartner = allUsers.find(u => u.email === PARTNER_EMAIL);
  if (oldPartner) {
    await admin.auth.admin.deleteUser(oldPartner.id);
    console.log('  Deleted old partner');
  }
  // Also delete any dev matches for the real user that are in pending/talked
  // (won't have a partner row after deletion due to cascade, but clean up directly)
  const { error: delErr } = await admin
    .from('matches')
    .delete()
    .or(`user_id_1.eq.${realUser.id},user_id_2.eq.${realUser.id}`)
    .in('status', ['pending', 'talked', 'connected']);
  if (delErr) console.warn('  Match cleanup warning:', delErr.message);
  else console.log('  Cleared old pending/talked matches');

  // ── 3. Create test partner ─────────────────────────────────────────────────
  console.log('\n── Creating test partner ──');
  const { data: newPartner, error: partnerErr } = await admin.auth.admin.createUser({
    email: PARTNER_EMAIL,
    password: PARTNER_PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: 'Alex' },
  });
  if (partnerErr) throw new Error(`Create partner: ${partnerErr.message}`);
  const partnerId = newPartner.user.id;
  console.log(`  Alex  ${partnerId}`);

  // Give the trigger a moment to create the public.users row
  await new Promise(r => setTimeout(r, 800));

  // Set partner's graduation year so the Match Screen shows "Class of XXXX"
  await must(
    admin.from('users').update({ graduation_year: 2027 }).eq('id', partnerId),
    'set partner grad year',
  );

  // ── 4. Insert the four matches ────────────────────────────────────────────
  console.log('\n── Inserting test matches ──');

  const base = {
    user_id_1:     realUser.id,
    user_id_2:     partnerId,
    trigger_type:  'hometown',
    trigger_value: 'Providence, RI',
    fired_at:      new Date().toISOString(),
  };

  const m1 = await mustData(
    admin.from('matches').insert({ ...base, status: 'pending', talked_by_user_id: null }).select('id').single(),
    'insert pending match',
  );
  const m2 = await mustData(
    admin.from('matches').insert({ ...base, status: 'talked', talked_by_user_id: realUser.id }).select('id').single(),
    'insert talked/me match',
  );
  const m3 = await mustData(
    admin.from('matches').insert({ ...base, status: 'talked', talked_by_user_id: partnerId }).select('id').single(),
    'insert talked/them match',
  );
  const m4 = await mustData(
    admin.from('matches').insert({ ...base, status: 'connected', talked_by_user_id: realUser.id }).select('id').single(),
    'insert connected match',
  );

  // Create the corresponding connections row (neither user has shared yet)
  const c1 = await mustData(
    admin.from('connections').insert({
      match_id:  m4.id,
      user_id_1: realUser.id,
      user_id_2: partnerId,
    }).select('id').single(),
    'insert connections row',
  );

  console.log(`  Pending:        ${m1.id}`);
  console.log(`  Talked / me:    ${m2.id}`);
  console.log(`  Talked / them:  ${m3.id}`);
  console.log(`  Connected:      ${m4.id}  (conn: ${c1.id})`);

  console.log('\n── Done ──');
  console.log('  Open the app and tap the dev match/share buttons on the Home screen.\n');

} catch (err) {
  console.error('\nFATAL:', err.message);
  process.exit(1);
}

async function must(promise, label) {
  const { error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function mustData(promise, label) {
  const { data, error } = await promise;
  if (error) {
    if (error.code === 'PGRST204' && error.message.includes('talked_by_user_id')) {
      throw new Error(
        `${label}: column 'talked_by_user_id' is missing from the matches table.\n` +
        `  → Run supabase/add-match-screen-support.sql in the Supabase SQL editor first.`,
      );
    }
    throw new Error(`${label}: ${error.message}`);
  }
  if (!data) throw new Error(`${label}: insert returned no data (check RLS or schema)`);
  return data;
}
