import { useState, useEffect, useCallback } from 'react';
import { Alert, Linking } from 'react-native';
import * as Location from 'expo-location';
import { LOCATION_TASK_NAME } from '../lib/backgroundTask';

// The location "engine". In the schedule-driven model there is no manual opt-in:
// the engine runs whenever permission is granted, and the background task gates
// actual pinging by the effective state (schedule XOR override). This hook only
// owns permission + engine lifecycle; the override toggle lives in the Home screen.
export type EngineStatus = 'checking' | 'running' | 'no_permission';

export function useLocationTracking() {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('checking');

  const startEngine = useCallback(async () => {
    const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(
      () => false
    );
    if (!alreadyRunning) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 60_000,
        distanceInterval: 0,
        // Keep updates flowing while backgrounded — iOS otherwise pauses
        // location when it thinks the device is stationary, which silently
        // stops pings. The in-task effective-state check still gates pinging.
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.Other,
        showsBackgroundLocationIndicator: true,
      });
    }
    setEngineStatus('running');
  }, []);

  // On mount: start the engine only if permission is already granted (no prompt).
  useEffect(() => {
    (async () => {
      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync();
      if (fg.status === 'granted' && bg.status === 'granted') {
        try {
          await startEngine();
        } catch {
          setEngineStatus('no_permission');
        }
      } else {
        setEngineStatus('no_permission');
      }
    })();
  }, [startEngine]);

  // Interactive: request "Always" permission then start the engine. Wired to the
  // Home permission prompt. Background location on iOS requires "Always" — "While
  // Using" is not enough because the task must keep pinging once backgrounded.
  const enableTracking = useCallback(async () => {
    let fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      if (!fg.canAskAgain) return showSettingsAlert();
      fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        if (!fg.canAskAgain) showSettingsAlert();
        return;
      }
    }

    let bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      if (!bg.canAskAgain) return explainAlwaysNeeded();
      bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') return explainAlwaysNeeded();
    }

    try {
      await startEngine();
    } catch (err: any) {
      Alert.alert(
        "Couldn't start location",
        err?.message ?? 'Something went wrong starting background location. Please try again.'
      );
      setEngineStatus('no_permission');
    }
  }, [startEngine]);

  return { engineStatus, enableTracking };
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
