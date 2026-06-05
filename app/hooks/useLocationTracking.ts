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

    // ── Background permission ──────────────────────────────────────────────
    const bgCurrent = await Location.getBackgroundPermissionsAsync();

    if (!bgCurrent.canAskAgain && bgCurrent.status !== 'granted') {
      showSettingsAlert();
      setStatus('no_permission');
      return;
    }

    if (bgCurrent.status !== 'granted') {
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') {
        if (!bg.canAskAgain) showSettingsAlert();
        setStatus('no_permission');
        return;
      }
    }

    // ── Start task ─────────────────────────────────────────────────────────
    const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (!alreadyRunning) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 60_000,
        distanceInterval: 0,
        showsBackgroundLocationIndicator: true,
      });
    }

    setStatus('active');
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
    'Amici needs location set to "Always" to find nearby connections.\n\nSettings → Expo Go → Location → Always',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]
  );
}
