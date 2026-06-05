import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { supabase } from './supabase';

export const LOCATION_TASK_NAME = 'amici-location';

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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const userId = session.user.id;

      if (!await isInActiveWindow(userId)) return;

      const { error: insertError } = await supabase.from('location_pings').insert({
        user_id: userId,
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });

      if (insertError) {
        console.warn('[location] ping insert failed:', insertError.message);
        return; // Don't invoke matching if the ping didn't land
      }

      // Trigger server-side matching. The edge function re-validates the
      // active window and dorm zone server-side; this call is fire-and-forget.
      const { error: fnError } = await supabase.functions.invoke('match-users', {
        body: { user_id: userId, lat: location.coords.latitude, lng: location.coords.longitude },
      });
      if (fnError) console.warn('[location] match function error:', fnError.message);
    } catch (err: any) {
      console.warn('[location] unexpected error:', err?.message);
    }
  }
);

// Returns true if the current local time falls within one of the user's active windows.
async function isInActiveWindow(userId: string): Promise<boolean> {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const currentTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:00`;

  const { data } = await supabase
    .from('active_windows')
    .select('start_time, end_time')
    .eq('user_id', userId)
    .eq('day_of_week', dayOfWeek);

  if (!data?.length) return false;

  return data.some((w) => currentTime >= w.start_time && currentTime < w.end_time);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
