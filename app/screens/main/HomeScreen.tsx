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
import * as Location from 'expo-location';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { supabase } from '../../lib/supabase';
import { useLocationTracking } from '../../hooks/useLocationTracking';
import { usePushToken } from '../../hooks/usePushToken';
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
  const [pingStatus, setPingStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const { status: trackingStatus, toggle: toggleTracking } = useLocationTracking();
  usePushToken();

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [profileRes, connRes] = await Promise.all([
      supabase
        .from('users')
        .select('first_name, profile_photo_url')
        .eq('id', user.id)
        .single(),
      supabase
        .from('connections')
        .select('id', { count: 'exact', head: true })
        .or(`user_id_1.eq.${user.id},user_id_2.eq.${user.id}`),
    ]);

    setSummary({
      first_name: profileRes.data?.first_name ?? '',
      profile_photo_url: profileRes.data?.profile_photo_url ?? null,
      connection_count: connRes.count ?? 0,
    });
  }, []);

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [load, navigation]);

  async function sendTestPing() {
    setPingStatus('sending');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        Alert.alert('Test Ping', 'Not signed in.');
        setPingStatus('error');
        setTimeout(() => setPingStatus('idle'), 2000);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { error } = await supabase.from('location_pings').insert({
        user_id: session.user.id,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
      if (error) throw error;
      setPingStatus('ok');
    } catch (err: any) {
      Alert.alert('Test Ping Failed', err?.message ?? 'Unknown error');
      setPingStatus('error');
    } finally {
      setTimeout(() => setPingStatus('idle'), 2000);
    }
  }

  // Opens the most recent match / connection for the current user in the given state.
  // Requires running scripts/create-dev-match.mjs first.
  async function openDevMatch(state: 'pending' | 'talked-me' | 'talked-them' | 'connected') {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (state === 'connected') {
      // Navigate to the ShareScreen directly
      const { data: conn } = await supabase
        .from('connections')
        .select('id, match_id')
        .or(`user_id_1.eq.${user.id},user_id_2.eq.${user.id}`)
        .order('connected_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (conn) {
        navigation.navigate('ShareModal', { matchId: conn.match_id, connectionId: conn.id });
      } else {
        Alert.alert('No connection found', 'Run scripts/create-dev-match.mjs first.');
      }
      return;
    }

    let query = supabase
      .from('matches')
      .select('id')
      .or(`user_id_1.eq.${user.id},user_id_2.eq.${user.id}`)
      .order('fired_at', { ascending: false })
      .limit(1);

    if (state === 'pending') {
      query = query.eq('status', 'pending');
    } else if (state === 'talked-me') {
      query = query.eq('status', 'talked').eq('talked_by_user_id', user.id);
    } else {
      query = query.eq('status', 'talked')
        .neq('talked_by_user_id', user.id)
        .not('talked_by_user_id', 'is', null);
    }

    const { data } = await query.maybeSingle();
    if (data) {
      navigation.navigate('MatchModal', { matchId: data.id });
    } else {
      Alert.alert(
        'No match found',
        'Run scripts/create-dev-match.mjs first.\n\nAdd REAL_USER_EMAIL to your .env first.',
      );
    }
  }

  const isActive = trackingStatus === 'active';
  const isChecking = trackingStatus === 'checking';
  const noPermission = trackingStatus === 'no_permission';

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
          <View style={styles.statusLeft}>
            <View style={[styles.statusDot, isActive ? styles.dotActive : styles.dotInactive]} />
            <View>
              <Text style={styles.statusLabel}>
                {isChecking ? 'Checking…' : isActive ? 'Listening' : noPermission ? 'Permission needed' : 'Paused'}
              </Text>
              <Text style={styles.statusSub}>
                {isActive
                  ? 'Looking for nearby connections'
                  : noPermission
                  ? 'Settings → Expo Go → Location → Always'
                  : 'Turn on to find nearby connections'}
              </Text>
            </View>
          </View>
          <Switch
            value={isActive}
            onValueChange={toggleTracking}
            disabled={isChecking}
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

        {__DEV__ && (
          <DevPanel
            pingStatus={pingStatus}
            onPing={sendTestPing}
            onOpenMatch={openDevMatch}
          />
        )}
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
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: colors.success },
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

// ─── Dev panel (DEV only) ─────────────────────────────────────────────────────

type DevPanelProps = {
  pingStatus: 'idle' | 'sending' | 'ok' | 'error';
  onPing: () => void;
  onOpenMatch: (state: 'pending' | 'talked-me' | 'talked-them' | 'connected') => void;
};

function DevPanel({ pingStatus, onPing, onOpenMatch }: DevPanelProps) {
  return (
    <View style={dev.panel}>
      <Text style={dev.label}>DEV</Text>

      {/* Ping row */}
      <TouchableOpacity
        style={[dev.btn, pingStatus === 'ok' && dev.btnOk, pingStatus === 'error' && dev.btnErr]}
        onPress={onPing}
        disabled={pingStatus === 'sending'}
        activeOpacity={0.7}
      >
        <Text style={dev.btnText}>
          {pingStatus === 'sending' ? 'Sending…'
            : pingStatus === 'ok'   ? 'Ping sent ✓'
            : pingStatus === 'error'? 'Failed ✗'
            : 'Send Test Ping'}
        </Text>
      </TouchableOpacity>

      {/* Match screen states */}
      <Text style={dev.sectionLabel}>Match Screen</Text>
      <View style={dev.row}>
        {(
          [
            { key: 'pending',     label: 'Pending' },
            { key: 'talked-me',   label: 'Talked / Me' },
            { key: 'talked-them', label: 'Talked / Them' },
          ] as const
        ).map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={dev.stateBtn}
            onPress={() => onOpenMatch(key)}
            activeOpacity={0.7}
          >
            <Text style={dev.stateBtnText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Share screen */}
      <Text style={dev.sectionLabel}>Share Screen</Text>
      <TouchableOpacity
        style={dev.stateBtn}
        onPress={() => onOpenMatch('connected')}
        activeOpacity={0.7}
      >
        <Text style={dev.stateBtnText}>Connected</Text>
      </TouchableOpacity>
    </View>
  );
}

const dev = StyleSheet.create({
  panel: {
    marginTop: spacing.xl,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, padding: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  label: {
    fontSize: 10, color: colors.secondary,
    letterSpacing: 1.5, fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 11, color: colors.secondary, marginTop: spacing.xs,
  },
  btn: {
    paddingVertical: 8, borderRadius: 7,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center',
  },
  btnOk:  { borderColor: colors.success },
  btnErr: { borderColor: colors.error },
  btnText: { fontSize: 13, color: colors.secondary },

  row: { flexDirection: 'row', gap: spacing.xs },
  stateBtn: {
    flex: 1, paddingVertical: 7, borderRadius: 7,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center',
  },
  stateBtnText: { fontSize: 12, color: colors.secondary },
});
