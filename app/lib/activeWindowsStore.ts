import { supabase } from './supabase';

// Shared persistence + shape for active windows, used by both the onboarding
// window step and the Profile "Active windows" section so they can never drift.
//
// A DayWindow[] always has length 7, indexed by day_of_week (0 = Sunday). Only
// enabled days are stored as rows in active_windows; disabled days keep sensible
// default times so re-enabling a day is painless. start > end means the window
// crosses midnight (see evaluateActiveWindow).

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type DayWindow = {
  enabled: boolean;
  start: string; // 'HH:MM:SS'
  end: string; // 'HH:MM:SS'
};

const DEFAULT_START = '10:00:00';
const DEFAULT_END = '22:00:00';

// Default week: every day enabled 10am–10pm (encourages lots of connection).
export function defaultWeek(): DayWindow[] {
  return Array.from({ length: 7 }, () => ({ enabled: true, start: DEFAULT_START, end: DEFAULT_END }));
}

// Load the user's windows into a 7-day array; disabled days get default times.
export async function loadActiveWindows(userId: string): Promise<DayWindow[]> {
  const week: DayWindow[] = Array.from({ length: 7 }, () => ({
    enabled: false,
    start: DEFAULT_START,
    end: DEFAULT_END,
  }));

  const { data, error } = await supabase
    .from('active_windows')
    .select('day_of_week, start_time, end_time')
    .eq('user_id', userId);
  if (error) throw error;

  for (const row of data ?? []) {
    if (row.day_of_week >= 0 && row.day_of_week <= 6) {
      week[row.day_of_week] = { enabled: true, start: row.start_time, end: row.end_time };
    }
  }
  return week;
}

// Validate then replace the user's windows (delete-then-insert). Throws with a
// user-facing message on the "at least one day" and zero-length guards.
export async function saveActiveWindows(userId: string, windows: DayWindow[]): Promise<void> {
  if (!windows.some((w) => w.enabled)) {
    throw new Error('Enable at least one day for active windows.');
  }
  const badDay = windows.findIndex((w) => w.enabled && w.start === w.end);
  if (badDay !== -1) {
    throw new Error(`${DAYS[badDay]}: start and end time can't be the same.`);
  }

  const rows = windows
    .map((w, day_of_week) => ({ day_of_week, ...w }))
    .filter((w) => w.enabled)
    .map((w) => ({
      user_id: userId,
      day_of_week: w.day_of_week,
      start_time: w.start,
      end_time: w.end,
    }));

  const { error: delErr } = await supabase.from('active_windows').delete().eq('user_id', userId);
  if (delErr) throw delErr;

  const { error: insErr } = await supabase.from('active_windows').insert(rows);
  if (insErr) throw insErr;
}
