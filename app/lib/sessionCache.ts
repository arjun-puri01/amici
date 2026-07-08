import AsyncStorage from '@react-native-async-storage/async-storage';

// Plain AsyncStorage cache of the signed-in user's id AND the access-token
// expiry. The background location task reads this instead of
// supabase.auth.getSession() so it never touches GoTrue's auth lock, and uses
// the expiry to decide whether making an auth-requiring call would trigger a
// background token refresh (which can latch the lock and wedge the app).
// Kept in sync by AuthContext on every auth state change.
const KEY = 'amici.session.v2';

export type CachedSession = {
  userId: string;
  expiresAtMs: number | null; // access-token expiry, epoch ms (null if unknown)
};

// `expiresAtSec` is Supabase's session.expires_at (unix seconds) or undefined.
export async function cacheSession(userId: string, expiresAtSec?: number | null): Promise<void> {
  try {
    const payload: CachedSession = {
      userId,
      expiresAtMs: expiresAtSec ? expiresAtSec * 1000 : null,
    };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Non-fatal: the task will just skip a ping if it can't read the session.
  }
}

export async function clearCachedSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Non-fatal.
  }
}

export async function getCachedSession(): Promise<CachedSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CachedSession) : null;
  } catch {
    return null;
  }
}
