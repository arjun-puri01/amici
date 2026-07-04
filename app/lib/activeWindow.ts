// Single source of truth for active-window evaluation. Both the background
// ping gate (backgroundTask.ts) and the Home screen indicator use this, so what
// the user sees always matches what actually gates pinging.
//
// All comparisons use DEVICE-LOCAL time (getDay/getHours/getMinutes), matching
// how windows are entered during onboarding. Times are naive wall-clock strings
// ('HH:MM:SS'); no UTC conversion happens here. (The server-side matching gate
// is intentionally evaluated in America/New_York and is separate from this.)

export type WindowRow = {
  day_of_week: number; // 0 = Sunday
  start_time: string; // 'HH:MM:SS'
  end_time: string; // 'HH:MM:SS'
};

export type ActiveWindowState = {
  isOpen: boolean;
  untilTime: string | null; // end_time of the open window, when open
  nextOpenTime: string | null; // start_time of the next window, when closed
  // Absolute local time at which the current open/closed state naturally flips.
  // Used to expire a manual override exactly at the schedule boundary.
  nextBoundaryAt: Date | null;
};

// A temporary manual override of the current scheduled state. It forces the
// effective tracking state until `expiresAt` (the next schedule boundary), then
// self-expires and the schedule reclaims control. Persisted so the background
// task sees it too. `expiresAt` is absolute epoch ms, so it is restart-safe and
// can never leave tracking stuck.
export type TrackingOverride = {
  userId: string;
  value: boolean; // forced effective state: true = force ON, false = force OFF
  expiresAt: number; // epoch ms
};

export type EffectiveTracking = {
  on: boolean; // whether tracking should actually ping right now
  overriding: boolean; // true when an active override is fighting the schedule
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Absolute local Date for a wall-clock 'HH:MM:SS' on now's date + dayOffset.
function atLocalTime(now: Date, hhmmss: string, dayOffset: number): Date {
  const [h, m, s] = hhmmss.split(':').map((n) => parseInt(n, 10));
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, s || 0, 0);
  return d;
}

function minutesOf(hhmmss: string): number {
  const [h, m] = hhmmss.split(':').map((n) => parseInt(n, 10));
  return h * 60 + m;
}

function toClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

type Interval = { start: Date; end: Date };

// Expand weekly windows into concrete local intervals around `now`. A window
// with start < end is same-day; a window with start > end CROSSES MIDNIGHT and
// ends on the following day. Scanning from yesterday (k = -1) through next week
// catches a crossing window that began yesterday and is still open past midnight.
// Overlapping/adjacent intervals are merged so "active until" spans them.
function buildIntervals(windows: WindowRow[], now: Date): Interval[] {
  const intervals: Interval[] = [];
  for (let k = -1; k <= 7; k++) {
    const base = new Date(now);
    base.setDate(base.getDate() + k);
    const dow = base.getDay();
    for (const w of windows) {
      if (w.day_of_week !== dow) continue;
      const sMin = minutesOf(w.start_time);
      const eMin = minutesOf(w.end_time);
      if (sMin === eMin) continue; // zero-length / invalid — ignore
      const start = atLocalTime(now, w.start_time, k);
      const end = atLocalTime(now, w.end_time, sMin > eMin ? k + 1 : k); // crossing -> next day
      intervals.push({ start, end });
    }
  }
  intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end.getTime() > last.end.getTime()) last.end = iv.end;
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }
  return merged;
}

export function evaluateActiveWindow(
  windows: WindowRow[],
  now: Date = new Date()
): ActiveWindowState {
  const intervals = buildIntervals(windows, now);
  const t = now.getTime();

  const current = intervals.find((iv) => iv.start.getTime() <= t && t < iv.end.getTime());
  if (current) {
    return {
      isOpen: true,
      untilTime: toClock(current.end),
      nextOpenTime: null,
      nextBoundaryAt: current.end,
    };
  }

  const next = intervals.find((iv) => iv.start.getTime() > t);
  return {
    isOpen: false,
    untilTime: null,
    nextOpenTime: next ? toClock(next.start) : null,
    nextBoundaryAt: next ? next.start : null,
  };
}

// The effective tracking state = schedule XOR a still-valid override. This is
// the single decision both the Home indicator and the background ping gate use,
// so what the user sees and what actually pings always agree.
export function effectiveTracking(
  schedule: ActiveWindowState,
  override: TrackingOverride | null,
  now: Date = new Date()
): EffectiveTracking {
  if (override && now.getTime() < override.expiresAt) {
    return { on: override.value, overriding: override.value !== schedule.isOpen };
  }
  return { on: schedule.isOpen, overriding: false };
}

// '22:00:00' -> '10:00 PM', '10:00:00' -> '10:00 AM'
export function formatTime12h(hhmmss: string): string {
  const [hStr, mStr] = hhmmss.split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}:00 ${ampm}` : `${h}:${pad(m)} ${ampm}`;
}
