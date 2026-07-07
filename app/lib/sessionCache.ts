import AsyncStorage from '@react-native-async-storage/async-storage';

// Plain AsyncStorage cache of the signed-in user's id. The background location
// task reads this instead of supabase.auth.getSession() so it never touches
// GoTrue's internal auth lock on every location fix (~once/min for a day).
// Kept in sync by AuthContext on every auth state change.
const KEY = 'amici.session.user-id';

export async function cacheUserId(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, userId);
  } catch {
    // Non-fatal: the task will just skip a ping if it can't read the id.
  }
}

export async function clearCachedUserId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Non-fatal.
  }
}

export async function getCachedUserId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}
