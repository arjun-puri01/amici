import 'react-native-url-polyfill/auto';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const supabaseUrl = extra.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = extra.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Auth token lifecycle, tuned for a 1-hour token that must survive background
// location. The background task NEVER refreshes (that latches GoTrue's lock and
// wedges the app — see progress.md "Known failure modes"), so we keep the token
// fresh from the FOREGROUND instead:
//   - Background: stop the auto-refresh timer entirely.
//   - Foreground: run the auto-refresh timer AND force an immediate renewal, so
//     the token is fresh whenever the app next backgrounds. Refreshing while
//     foregrounded is safe — the app is active, so the lock is released promptly
//     rather than frozen mid-flight by iOS.
let refreshing = false;
let lastRefreshAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

async function forceForegroundRefresh() {
  if (refreshing) return; // don't overlap refreshes
  if (Date.now() - lastRefreshAt < 60_000) return; // throttle rapid app switches
  refreshing = true;
  try {
    // startAutoRefresh() only refreshes when within ~90s of expiry, so force it.
    const { error } = await supabase.auth.refreshSession();
    if (!error) lastRefreshAt = Date.now();
  } catch {
    // Offline / transient — the foreground auto-refresh ticker will retry.
  } finally {
    refreshing = false;
  }
}

function syncAutoRefresh(state: AppStateStatus) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (state === 'background') {
    supabase.auth.stopAutoRefresh();
    return;
  }
  // Foreground (active / inactive): keep the token renewing.
  supabase.auth.startAutoRefresh();
  if (state === 'active') {
    // Force a renewal shortly after becoming active — delayed + cancelable so a
    // quick open-then-close doesn't start a refresh that could freeze mid-flight.
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void forceForegroundRefresh();
    }, 1500);
  }
}
AppState.addEventListener('change', syncAutoRefresh);
syncAutoRefresh(AppState.currentState);
