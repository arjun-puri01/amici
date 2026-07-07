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

// Only run the auth token auto-refresh timer while the app is foregrounded.
// Running it in the background contends with GoTrue's internal auth lock and,
// over a long background run (e.g. the background location task alive for a
// day), can leave that lock permanently held — which then deadlocks the UI on
// next launch (getSession never resolves). See progress.md "Known failure modes".
function syncAutoRefresh(state: AppStateStatus) {
  if (state === 'background') {
    supabase.auth.stopAutoRefresh();
  } else {
    supabase.auth.startAutoRefresh();
  }
}
AppState.addEventListener('change', syncAutoRefresh);
syncAutoRefresh(AppState.currentState);
