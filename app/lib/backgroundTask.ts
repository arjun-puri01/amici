import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { supabase } from './supabase';
import { evaluateActiveWindow, effectiveTracking } from './activeWindow';
import { loadOverride } from './trackingOverride';
import { getCachedUserId } from './sessionCache';

export const LOCATION_TASK_NAME = 'amici-location';

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
      // Read the user id from AsyncStorage instead of supabase.auth.getSession()
      // so this hot path (runs every fix) never touches GoTrue's auth lock.
      const userId = await getCachedUserId();
      if (!userId) return;

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
