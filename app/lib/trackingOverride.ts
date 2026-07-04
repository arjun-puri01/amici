import AsyncStorage from '@react-native-async-storage/async-storage';
import { TrackingOverride } from './activeWindow';

// Persistent store for the temporary tracking override. Persisted (not just in
// memory) because the background location task — which runs while the app is
// backgrounded or killed — must see it to gate pings. Kept restart-safe by
// validating the owner and absolute expiry on every read.
const KEY = 'amici.tracking.override.v1';

// Returns the override only if it belongs to the current user and hasn't
// expired; otherwise removes it and returns null. This is the self-healing
// step that guarantees an override can never linger past its boundary.
export async function loadOverride(userId: string, now: Date): Promise<TrackingOverride | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as TrackingOverride;
    if (o.userId !== userId || now.getTime() >= o.expiresAt) {
      await AsyncStorage.removeItem(KEY);
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export async function saveOverride(o: TrackingOverride): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(o));
}

export async function clearOverride(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
