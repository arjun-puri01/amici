import { useState, useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import * as Location from 'expo-location';
import { LOCATION_TASK_NAME } from '../lib/backgroundTask';

export type TrackingStatus = 'checking' | 'active' | 'inactive' | 'no_permission';

export function useLocationTracking() {
  const [status, setStatus] = useState<TrackingStatus>('checking');

  useEffect(() => {
    (async () => {
      const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
      if (running) {
        setStatus('active');
        return;
      }
      // Only reflect denied state when the OS won't let us ask again.
      const fg = await Location.getForegroundPermissionsAsync();
      if (!fg.canAskAgain && fg.status !== 'granted') {
        setStatus('no_permission');
        return;
      }
      const bg = await Location.getBackgroundPermissionsAsync();
      if (!bg.canAskAgain && bg.status !== 'granted') {
        setStatus('no_permission');
        return;
      }
      setStatus('inactive');
    })();
  }, []);

  async function start() {
    // ── Foreground permission ──────────────────────────────────────────────
    const fgCurrent = await Location.getForegroundPermissionsAsync();

    if (!fgCurrent.canAskAgain && fgCurrent.status !== 'granted') {
      // iOS will not show the dialog again — user must go to Settings.
      showSettingsAlert();
      setStatus('no_permission');
      return;
    }

    if (fgCurrent.status !== 'granted') {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        if (!fg.canAskAgain) showSettingsAlert();
        setStatus('no_permission');
        return;
      }
    }

    // ── Background ("Always") permission ───────────────────────────────────
    // Background location on iOS requires "Always". "While Using" is not enough:
    // the task must keep pinging after the app is backgrounded.
    let bg = await Location.getBackgroundPermissionsAsync();

    if (bg.status !== 'granted' && bg.canAskAgain) {
      bg = await Location.requestBackgroundPermissionsAsync();
    }

    if (bg.status !== 'granted') {
      // User granted only "While Using" (or denied). Explain why Always is
      // required and point them to Settings — don't start, since the task
      // cannot run in the background without it.
      explainAlwaysNeeded();
      setStatus('no_permission');
      return;
    }

    // ── Start task ─────────────────────────────────────────────────────────
    try {
      const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (!alreadyRunning) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 60_000,
          distanceInterval: 0,
          // Keep updates flowing while backgrounded — iOS otherwise pauses
          // location when it thinks the device is stationary, which silently
          // stops pings. The in-task active-window check still gates pinging.
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.Other,
          showsBackgroundLocationIndicator: true,
        });
      }
      setStatus('active');
    } catch (err: any) {
      Alert.alert(
        "Couldn't start location",
        err?.message ?? 'Something went wrong starting background location. Please try again.'
      );
      setStatus('inactive');
    }
  }

  async function stop() {
    const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (running) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
    setStatus('inactive');
  }

  async function toggle() {
    if (status === 'active') {
      await stop();
    } else {
      await start();
    }
  }

  return { status, start, stop, toggle };
}

function showSettingsAlert() {
  Alert.alert(
    'Location access needed',
    'Amici needs location set to "Always" to find nearby connections while running in the background.\n\nSettings → Amici → Location → Always',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]
  );
}

// Shown when the user grants only "While Using" (or denies background). Amici
// works by checking your location in the background during your active windows,
// which iOS only allows with "Always".
function explainAlwaysNeeded() {
  Alert.alert(
    'Set location to "Always"',
    'Amici only works while it runs quietly in the background during your active windows — so iOS requires location set to "Always". With "While Using" it can\'t notify you once the app is closed.\n\nSettings → Amici → Location → Always',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]
  );
}
