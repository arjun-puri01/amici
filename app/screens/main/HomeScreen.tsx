import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Switch,
} from 'react-native';
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
                  ? 'Settings → Amici → Location → Always'
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
