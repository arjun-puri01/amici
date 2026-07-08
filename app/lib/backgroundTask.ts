import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { supabase } from './supabase';
import { evaluateActiveWindow, effectiveTracking } from './activeWindow';
import { loadOverride } from './trackingOverride';
import { getCachedSession } from './sessionCache';

export const LOCATION_TASK_NAME = 'amici-location';

// If the access token expires within this window, treat it as stale and skip all
// auth-requiring calls this cycle. Comfortably larger than GoTrue's own refresh
// margin, so a background getSession() never decides to refresh under the lock.
const TOKEN_SKEW_MS = 120_000;

// Cap background network calls so a hung request (common when iOS suspends the
// app mid-flight) can't stall a task invocation indefinitely. Rejects on
// timeout; callers treat that like any other failure and bail.
function withTimeout<T>(op: PromiseLike<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(op), timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// defineTask must be called at module evaluation time, before the app renders.
// This file is imported at the top of App.tsx for that reason.
TaskManager.defineTask(
  LOCATION_TASK_NAME,
  async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
    if (error) {
      console.warn('[location] task error:', error.message);
      return;
    }

    const location = data?.locations?.[0];
    if (!location) return;

    try {
      // Read the session from AsyncStorage instead of supabase.auth.getSession()
      // so this hot path (runs every fix) never touches GoTrue's auth lock.
      const session = await getCachedSession();
      if (!session) return;
      const userId = session.userId;

      // If the access token is expired/stale, DO NOT make any auth-requiring
      // call: every PostgREST/Functions call runs _getAccessToken() ->
      // getSession(), which would trigger a token refresh under the GoTrue lock.
      // If iOS freezes the runtime mid-refresh the lock latches and the app
      // hangs on next launch. Defer to foreground, where AppState-gated
      // auto-refresh renews the token safely, then pings resume.
      if (!session.expiresAtMs || session.expiresAtMs - Date.now() < TOKEN_SKEW_MS) {
        console.warn('[location] access token stale — deferring pings until foreground refresh');
        return;
      }

      if (!await shouldPingNow(userId)) return;

      const { error: insertError } = await withTimeout(
        supabase.from('location_pings').insert({
          user_id: userId,
          lat: location.coords.latitude,
          lng: location.coords.longitude,
        }),
        10_000,
        'ping insert'
      );

      if (insertError) {
        console.warn('[location] ping insert failed:', insertError.message);
        return; // Don't invoke matching if the ping didn't land
      }

      // Trigger server-side matching. The edge function re-validates the
      // active window and dorm zone server-side; this call is fire-and-forget.
      const { error: fnError } = await withTimeout(
        supabase.functions.invoke('match-users', {
          body: { user_id: userId, lat: location.coords.latitude, lng: location.coords.longitude },
        }),
        15_000,
        'match-users invoke'
      );
      if (fnError) console.warn('[location] match function error:', fnError.message);
    } catch (err: any) {
      console.warn('[location] unexpected error:', err?.message);
    }
  }
);

// Whether tracking should ping right now = the EFFECTIVE state (schedule XOR a
// still-valid manual override), not just the schedule. Uses the exact same
// evaluateActiveWindow + effectiveTracking the Home indicator uses, and reads
// the same persisted override, so pinging and the on-screen state always agree.
async function shouldPingNow(userId: string): Promise<boolean> {
  const now = new Date();

  const { data } = await withTimeout(
    supabase.from('active_windows').select('day_of_week, start_time, end_time').eq('user_id', userId),
    10_000,
    'active_windows fetch'
  );

  const schedule = evaluateActiveWindow(data ?? [], now);
  const override = await loadOverride(userId, now); // validates owner + expiry
  return effectiveTracking(schedule, override, now).on;
}
