import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';

// Registers this device's Expo push token with Supabase so the edge function
// can look it up when firing a match notification.
// Must be called from a component that is only rendered when the user is
// authenticated and fully onboarded.
//
// FLAG: push token registration and APNs delivery require a real device.
// The simulator will fail to obtain a real token. The hook handles this
// gracefully — a missing token simply means that user won't receive pushes.
export function usePushToken() {
  useEffect(() => {
    register();
  }, []);
}

async function register() {
  if (Platform.OS !== 'ios') return;

  // ── Permission ──────────────────────────────────────────────────────────
  const result = await Notifications.requestPermissionsAsync();
  const authorized =
    result.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!authorized) {
    console.log('[push] Permission not granted — skipping token registration');
    return;
  }

  // ── Token ───────────────────────────────────────────────────────────────
  // projectId is required by Expo SDK 49+. Set it in app.json under
  // expo.extra.eas.projectId once you've linked the project in EAS.
  let token: string;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch (err: any) {
    // Common in the simulator — APNs requires a physical device.
    console.warn('[push] Could not obtain push token:', err?.message);
    return;
  }

  // ── Save to Supabase ────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from('users')
    .update({ expo_push_token: token })
    .eq('id', user.id);

  if (error) {
    console.warn('[push] Failed to save push token:', error.message);
  } else {
    console.log('[push] Token registered:', token);
  }
}
