import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'History'>;
};

type HistoryItem = {
  matchId: string;
  userId: string;
  firstName: string;
  photoUrl: string | null;
  triggerType: 'hometown' | 'interest';
  triggerValue: string;
  firedAt: string;
  status: 'missed' | 'talked' | 'connected';
  timesMatched: number;
  theySharedInstagram: boolean;
  theySharedPhone: boolean;
};

type Filter = 'all' | 'missed' | 'talked' | 'connected';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'missed',    label: 'Near-misses' },
  { key: 'talked',    label: 'Talked' },
  { key: 'connected', label: 'Connected' },
];

export default function HistoryScreen({ navigation: _navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems]     = useState<HistoryItem[]>([]);
  const [filter, setFilter]   = useState<Filter>('all');

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: matches } = await supabase
      .from('matches')
      .select('id, user_id_1, user_id_2, trigger_type, trigger_value, fired_at, status')
      .or(`user_id_1.eq.${user.id},user_id_2.eq.${user.id}`)
      .neq('status', 'pending')
      .order('fired_at', { ascending: false });

    if (!matches || matches.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    // Deduplicated other-user IDs
    const otherIdSet = new Set<string>();
    for (const m of matches) {
      otherIdSet.add(m.user_id_1 === user.id ? m.user_id_2 : m.user_id_1);
    }

    const { data: profiles } = await supabase
      .from('users')
      .select('id, first_name, profile_photo_url')
      .in('id', [...otherIdSet]);

    const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));

    // Fetch connections for connected matches
    const connectedIds = matches.filter(m => m.status === 'connected').map(m => m.id);
    const connMap = new Map<string, any>();
    if (connectedIds.length > 0) {
      const { data: conns } = await supabase
        .from('connections')
        .select('match_id, user_id_1, shared_instagram_1, shared_instagram_2, shared_phone_1, shared_phone_2')
        .in('match_id', connectedIds);
      for (const c of conns ?? []) connMap.set(c.match_id, c);
    }

    // Count total matches per other user for "crossed paths N times"
    const pairCounts = new Map<string, number>();
    for (const m of matches) {
      const oid = m.user_id_1 === user.id ? m.user_id_2 : m.user_id_1;
      pairCounts.set(oid, (pairCounts.get(oid) ?? 0) + 1);
    }

    setItems(matches.map(m => {
      const otherId = m.user_id_1 === user.id ? m.user_id_2 : m.user_id_1;
      const profile = profileMap.get(otherId);
      const conn    = connMap.get(m.id);

      let theySharedInstagram = false;
      let theySharedPhone = false;
      if (conn) {
        const iAmUser1 = conn.user_id_1 === user.id;
        theySharedInstagram = iAmUser1 ? conn.shared_instagram_2 : conn.shared_instagram_1;
        theySharedPhone     = iAmUser1 ? conn.shared_phone_2     : conn.shared_phone_1;
      }

      return {
        matchId: m.id,
        userId: otherId,
        firstName: profile?.first_name ?? '?',
        photoUrl: profile?.profile_photo_url ?? null,
        triggerType: m.trigger_type,
        triggerValue: m.trigger_value,
        firedAt: m.fired_at,
        status: m.status as 'missed' | 'talked' | 'connected',
        timesMatched: pairCounts.get(otherId) ?? 1,
        theySharedInstagram,
        theySharedPhone,
      };
    }));

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = filter === 'all' ? items : items.filter(i => i.status === filter);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.secondary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipActive]}
            onPress={() => setFilter(f.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={visible}
        keyExtractor={item => item.matchId}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {filter === 'all' ? 'No matches yet.' : `No ${filter} matches.`}
          </Text>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => <HistoryRow item={item} />}
      />
    </View>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function HistoryRow({ item }: { item: HistoryItem }) {
  const triggerText = item.triggerType === 'hometown'
    ? `Both from ${item.triggerValue}`
    : `Both love ${item.triggerValue}`;

  const statusLabel = item.status === 'connected' ? 'Connected'
    : item.status === 'talked' ? 'Waiting'
    : 'Near miss';

  const statusColor = item.status === 'connected' ? colors.success
    : item.status === 'talked' ? colors.accent
    : colors.secondary;

  return (
    <View style={styles.row}>
      <View style={styles.photoCol}>
        {item.photoUrl
          ? <Image source={{ uri: item.photoUrl }} style={styles.photo} />
          : <View style={[styles.photo, styles.photoFallback]} />
        }
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{item.firstName}</Text>
          <Text style={[styles.badge, { color: statusColor }]}>{statusLabel}</Text>
        </View>

        <Text style={styles.trigger}>{triggerText}</Text>
        <Text style={styles.date}>{formatDate(item.firedAt)}</Text>

        {item.timesMatched > 1 && (
          <Text style={styles.crossedPaths}>
            Crossed paths {item.timesMatched} times
          </Text>
        )}

        {item.status === 'connected' && (item.theySharedInstagram || item.theySharedPhone) && (
          <View style={styles.sharedRow}>
            {item.theySharedInstagram && (
              <View style={styles.sharedChip}>
                <Text style={styles.sharedChipText}>Instagram</Text>
              </View>
            )}
            {item.theySharedPhone && (
              <View style={styles.sharedChip}>
                <Text style={styles.sharedChipText}>Phone</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const PHOTO_SIZE = 44;

const styles = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  container: { flex: 1, backgroundColor: colors.background },

  filterRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: 'transparent' },
  chipText:   { fontSize: 13, color: colors.secondary },
  chipTextActive: { color: colors.accent },

  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  separator: { height: 1, backgroundColor: colors.border, marginVertical: 1 },
  empty: {
    textAlign: 'center', color: colors.secondary, fontSize: 14,
    paddingTop: spacing.xl,
  },

  row: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: spacing.md, gap: spacing.md,
  },
  photoCol: { paddingTop: 2 },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: PHOTO_SIZE / 2 },
  photoFallback: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },

  info: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name:  { fontSize: 15, color: colors.primary, fontWeight: '400' },
  badge: { fontSize: 12, fontWeight: '500' },
  trigger: { fontSize: 13, color: colors.secondary },
  date:    { fontSize: 12, color: colors.secondary },
  crossedPaths: { fontSize: 11, color: colors.accent, marginTop: 2 },

  sharedRow: { flexDirection: 'row', gap: spacing.xs, marginTop: 4 },
  sharedChip: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10, borderWidth: 1, borderColor: colors.success,
  },
  sharedChipText: { fontSize: 11, color: colors.success },
});
