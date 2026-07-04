import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Switch,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { supabase } from '../../lib/supabase';
import { useLocationTracking } from '../../hooks/useLocationTracking';
import { usePushToken } from '../../hooks/usePushToken';
import {
  evaluateActiveWindow,
  effectiveTracking,
  formatTime12h,
  WindowRow,
  TrackingOverride,
} from '../../lib/activeWindow';
import { loadOverride, saveOverride, clearOverride } from '../../lib/trackingOverride';
import { colors, spacing } from '../../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Main'>;
};

type Summary = {
  first_name: string;
  profile_photo_url: string | null;
  connection_count: number;
};

export default function HomeScreen({ navigation }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [windows, setWindows] = useState<WindowRow[]>([]);
  const [override, setOverride] = useState<TrackingOverride | null>(null);
  const [now, setNow] = useState(new Date());
  const { engineStatus, enableTracking } = useLocationTracking();
  usePushToken();

  const load = useCallback(async () => {
    setNow(new Date()); // refresh the indicator immediately on focus
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [profileRes, connRes, windowsRes] = await Promise.all([
      supabase
        .from('users')
        .select('first_name, profile_photo_url')
        .eq('id', user.id)
        .single(),
      supabase
        .from('connections')
        .select('id', { count: 'exact', head: true })
        .or(`user_id_1.eq.${user.id},user_id_2.eq.${user.id}`),
      supabase
        .from('active_windows')
        .select('day_of_week, start_time, end_time')
        .eq('user_id', user.id),
    ]);

    setSummary({
      first_name: profileRes.data?.first_name ?? '',
      profile_photo_url: profileRes.data?.profile_photo_url ?? null,
      connection_count: connRes.count ?? 0,
    });

    if (windowsRes.error) {
      console.warn('[home] failed to load active windows:', windowsRes.error.message);
    } else {
      setWindows((windowsRes.data as WindowRow[]) ?? []);
    }

    // Read any persisted override (self-heals if expired or for another user).
    setOverride(await loadOverride(user.id, new Date()));
  }, []);

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [load, navigation]);

  // Tick so the indicator flips when a schedule or override boundary passes
  // while the screen is open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Clear an expired override from state + storage the moment it lapses, so no
  // stale override lingers past its boundary.
  useEffect(() => {
    if (override && Date.now() >= override.expiresAt) {
      clearOverride().catch(() => {});
      setOverride(null);
    }
  }, [now, override]);

  const isChecking = engineStatus === 'checking';
  const noPermission = engineStatus === 'no_permission';
  const hasWindows = windows.length > 0;

  const schedule = evaluateActiveWindow(windows, now);
  const eff = effectiveTracking(schedule, override, now); // { on, overriding }
  // What the Switch shows: only meaningful when the engine can actually run.
  const trackingOn = !isChecking && !noPermission && hasWindows && eff.on;

  // Toggle = temporary override of the current effective state. Toggling back to
  // the natural (scheduled) state clears the override; otherwise it forces the
  // opposite state until the schedule's next boundary.
  async function onToggleOverride() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const next = !eff.on;
      if (next === schedule.isOpen || !schedule.nextBoundaryAt) {
        await clearOverride();
        setOverride(null);
      } else {
        const o: TrackingOverride = {
          userId: user.id,
          value: next,
          expiresAt: schedule.nextBoundaryAt.getTime(),
        };
        await saveOverride(o);
        setOverride(o);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? "Couldn't update tracking.");
    }
  }

  // Label + dot reflect the effective state, and when an override is fighting the
  // schedule the sub-line says what tracking would NORMALLY be doing.
  let statusLabel: string;
  let statusSub: string;
  let dotStyle = styles.dotInactive;

  if (isChecking) {
    statusLabel = 'Checking…';
    statusSub = '';
  } else if (noPermission) {
    statusLabel = 'Location off';
    statusSub = 'Tap to enable — needs Always';
  } else if (!hasWindows) {
    statusLabel = 'No active windows';
    statusSub = 'Set active windows first';
  } else if (eff.on && !eff.overriding) {
    statusLabel = 'Listening';
    statusSub = schedule.untilTime ? `Active until ${formatTime12h(schedule.untilTime)}` : 'Active';
    dotStyle = styles.dotActive;
  } else if (!eff.on && !eff.overriding) {
    statusLabel = 'Off';
    statusSub = schedule.nextOpenTime ? `Opens ${formatTime12h(schedule.nextOpenTime)}` : 'No upcoming window';
  } else if (eff.on && eff.overriding) {
    statusLabel = 'On';
    statusSub = schedule.nextOpenTime
      ? `Normally closed until ${formatTime12h(schedule.nextOpenTime)}`
      : 'Forced on';
    dotStyle = styles.dotPaused;
  } else {
    // !eff.on && eff.overriding — forced off inside a window
    statusLabel = 'Off';
    statusSub = schedule.untilTime
      ? `Normally active until ${formatTime12h(schedule.untilTime)}`
      : 'Forced off';
    dotStyle = styles.dotPaused;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>Amici</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Profile')} activeOpacity={0.7}>
          {summary?.profile_photo_url ? (
            <Image source={{ uri: summary.profile_photo_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Status card */}
        <View style={styles.statusCard}>
          <TouchableOpacity
            style={styles.statusLeft}
            activeOpacity={noPermission ? 0.7 : 1}
            disabled={!noPermission}
            onPress={noPermission ? enableTracking : undefined}
          >
            <View style={[styles.statusDot, dotStyle]} />
            <View style={styles.statusText}>
              <Text style={styles.statusLabel}>{statusLabel}</Text>
              {statusSub ? <Text style={styles.statusSub}>{statusSub}</Text> : null}
            </View>
          </TouchableOpacity>
          <Switch
            value={trackingOn}
            onValueChange={onToggleOverride}
            disabled={isChecking || noPermission || !hasWindows}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.primary}
          />
        </View>

        {/* Connection count */}
        {summary && summary.connection_count > 0 && (
          <View style={styles.statRow}>
            <Text style={styles.statNumber}>{summary.connection_count}</Text>
            <Text style={styles.statLabel}>
              {summary.connection_count === 1 ? 'connection' : 'connections'}
            </Text>
          </View>
        )}

        {summary?.connection_count === 0 && (
          <Text style={styles.emptyHint}>
            Amici runs quietly in the background. You'll get a notification when someone nearby shares something with you.
          </Text>
        )}

        <TouchableOpacity
          style={styles.historyLink}
          onPress={() => navigation.navigate('History')}
          activeOpacity={0.7}
        >
          <Text style={styles.historyLinkText}>Match history</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 64,
    paddingBottom: spacing.md,
  },
  wordmark: { fontSize: 20, color: colors.primary, fontWeight: '600', letterSpacing: -0.3 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarPlaceholder: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },

  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
  },
  statusLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: colors.success },
  dotPaused: { backgroundColor: colors.accent },
  dotInactive: { backgroundColor: colors.secondary },
  statusLabel: { fontSize: 15, color: colors.primary, fontWeight: '500' },
  statusSub: { fontSize: 12, color: colors.secondary, marginTop: 2 },

  statRow: { alignItems: 'center', paddingVertical: spacing.xl, gap: 4 },
  statNumber: { fontSize: 48, color: colors.primary, fontWeight: '300' },
  statLabel: { fontSize: 14, color: colors.secondary },

  emptyHint: {
    color: colors.secondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },

  historyLink: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  historyLinkText: {
    fontSize: 13,
    color: colors.secondary,
    textDecorationLine: 'underline',
  },

});
