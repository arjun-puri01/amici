import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'MatchModal'>;
  route: RouteProp<RootStackParamList, 'MatchModal'>;
};

type MatchRow = {
  id: string;
  user_id_1: string;
  user_id_2: string;
  trigger_type: 'hometown' | 'interest';
  trigger_value: string;
  status: 'pending' | 'talked' | 'connected' | 'missed';
  talked_by_user_id: string | null;
};

type OtherUser = {
  id: string;
  first_name: string;
  profile_photo_url: string | null;
  graduation_year: number;
};

const TIMEOUT_SECONDS = 5 * 60; // 5 minutes — spec says "a few minutes"

export default function MatchScreen({ navigation, route }: Props) {
  const { matchId } = route.params;

  const [loading, setLoading]           = useState(true);
  const [match, setMatch]               = useState<MatchRow | null>(null);
  const [otherUser, setOtherUser]       = useState<OtherUser | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [secondsLeft, setSecondsLeft]   = useState(TIMEOUT_SECONDS);
  const [talkSent, setTalkSent]         = useState(false);

  // Pulse ring animation
  const pulseScale   = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseScale,   { toValue: 1.4,  duration: 1600, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0,    duration: 1600, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(pulseScale,   { toValue: 1,    duration: 0,    useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.45, duration: 0,    useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulseScale, pulseOpacity]);

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigation.goBack(); return; }
    setCurrentUserId(user.id);

    const { data: matchData, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (error || !matchData) { navigation.goBack(); return; }

    if (matchData.status === 'missed') {
      navigation.goBack();
      return;
    }

    // Match already connected — jump straight to ShareScreen
    if (matchData.status === 'connected') {
      const { data: conn } = await supabase
        .from('connections')
        .select('id')
        .eq('match_id', matchId)
        .maybeSingle();
      if (conn?.id) {
        navigation.replace('ShareModal', { matchId, connectionId: conn.id });
      } else {
        navigation.goBack();
      }
      return;
    }

    setMatch(matchData);

    const otherId = matchData.user_id_1 === user.id
      ? matchData.user_id_2
      : matchData.user_id_1;

    const { data: userData } = await supabase
      .from('users')
      .select('id, first_name, profile_photo_url, graduation_year')
      .eq('id', otherId)
      .single();

    setOtherUser(userData);
    setLoading(false);
  }, [matchId, navigation]);

  useEffect(() => { load(); }, [load]);

  // ── Countdown timer ─────────────────────────────────────────────────────────
  // Runs only while the match is pending and the user hasn't acted yet.
  // Uses a recursive setTimeout so the interval doesn't drift.

  const handleSkip = useCallback(async () => {
    await supabase.from('matches').update({ status: 'missed' }).eq('id', matchId);
    navigation.goBack();
  }, [matchId, navigation]);

  const handleSkipRef = useRef(handleSkip);
  handleSkipRef.current = handleSkip;

  useEffect(() => {
    const isPending = match?.status === 'pending' && !talkSent;
    if (!isPending) return;
    if (secondsLeft <= 0) { handleSkipRef.current(); return; }
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, match?.status, talkSent]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleTalked() {
    setActionLoading(true);
    const { error } = await supabase.functions.invoke('handle-talked', {
      body: { match_id: matchId },
    });
    setActionLoading(false);
    if (error) {
      Alert.alert('Something went wrong', error.message);
      return;
    }
    setTalkSent(true);
  }

  async function handleConfirm() {
    setActionLoading(true);
    const { data, error } = await supabase.functions.invoke<{ connection_id: string }>('handle-confirm', {
      body: { match_id: matchId },
    });
    setActionLoading(false);
    if (error || !data) {
      Alert.alert('Something went wrong', error?.message ?? 'Please try again');
      return;
    }
    navigation.replace('ShareModal', { matchId, connectionId: data.connection_id });
  }

  async function handleNope() {
    await supabase.from('matches').update({ status: 'missed' }).eq('id', matchId);
    navigation.goBack();
  }

  // ── Realtime: User A watching for their match to become connected ───────────
  // When User B calls handle-confirm the match status transitions to 'connected'.
  // User A may still have this screen open showing "Waiting for them to confirm…"
  // so we subscribe here and navigate them to ShareModal when it fires.

  useEffect(() => {
    const channel = supabase
      .channel(`match:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        async (payload) => {
          if (payload.new.status !== 'connected') return;
          const { data: conn } = await supabase
            .from('connections')
            .select('id')
            .eq('match_id', matchId)
            .maybeSingle();
          if (conn?.id) {
            navigation.replace('ShareModal', { matchId, connectionId: conn.id });
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [matchId, navigation]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.secondary} />
      </View>
    );
  }

  if (!match || !otherUser) return null;

  const triggerText = match.trigger_type === 'hometown'
    ? `You're both from ${match.trigger_value}`
    : `You both love ${match.trigger_value}`;

  const iAmInitiator     = talkSent || match.talked_by_user_id === currentUserId;
  const otherInitiated   = match.status === 'talked' && match.talked_by_user_id !== null && !iAmInitiator;
  const isPending        = match.status === 'pending' && !talkSent;

  return (
    <View style={styles.container}>
      {/* Minimize — dismisses without acting */}
      <TouchableOpacity
        style={styles.minimize}
        onPress={() => navigation.goBack()}
        activeOpacity={0.6}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.minimizeLabel}>Minimize</Text>
      </TouchableOpacity>

      <View style={styles.body}>
        {/* Photo + pulse ring */}
        <View style={styles.photoWrap}>
          <Animated.View
            style={[
              styles.pulseRing,
              { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
            ]}
          />
          {otherUser.profile_photo_url ? (
            <Image
              source={{ uri: otherUser.profile_photo_url }}
              style={styles.photo}
            />
          ) : (
            <View style={[styles.photo, styles.photoFallback]} />
          )}
        </View>

        {/* Identity */}
        <Text style={styles.name}>{otherUser.first_name}</Text>
        <Text style={styles.gradYear}>Class of {otherUser.graduation_year}</Text>

        {/* Shared trigger */}
        <Text style={styles.trigger}>{triggerText}</Text>

        {/* State-specific content */}
        {iAmInitiator && (
          <View style={styles.statusBlock}>
            <Text style={styles.statusLabel}>
              Message sent to {otherUser.first_name}
            </Text>
            <Text style={styles.statusSub}>Waiting for them to confirm…</Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}

        {otherInitiated && !iAmInitiator && (
          <View style={styles.statusBlock}>
            <Text style={styles.statusLabel}>
              {otherUser.first_name} says you two talked
            </Text>
            <Text style={styles.statusSub}>Did you?</Text>

            <View style={styles.buttons}>
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={handleNope}
                disabled={actionLoading}
                activeOpacity={0.7}
              >
                <Text style={styles.skipText}>Nope</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.talkedBtn}
                onPress={handleConfirm}
                disabled={actionLoading}
                activeOpacity={0.8}
              >
                {actionLoading
                  ? <ActivityIndicator color={colors.background} size="small" />
                  : <Text style={styles.talkedText}>Yes we did</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isPending && (
          <>
            <Text style={styles.countdown}>{formatTime(secondsLeft)}</Text>

            <View style={styles.buttons}>
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={handleSkip}
                disabled={actionLoading}
                activeOpacity={0.7}
              >
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.talkedBtn}
                onPress={handleTalked}
                disabled={actionLoading}
                activeOpacity={0.8}
              >
                {actionLoading
                  ? <ActivityIndicator color={colors.background} size="small" />
                  : <Text style={styles.talkedText}>We Talked</Text>
                }
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const PHOTO_SIZE = 120;
const RING_SIZE  = PHOTO_SIZE + 40;

const styles = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },

  container: {
    flex: 1, backgroundColor: colors.background,
  },

  minimize: {
    position: 'absolute', top: 56, right: spacing.xl,
    zIndex: 10,
  },
  minimizeLabel: {
    fontSize: 14, color: colors.secondary,
  },

  body: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },

  photoWrap: {
    width: RING_SIZE, height: RING_SIZE,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  pulseRing: {
    position: 'absolute',
    width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2,
    borderWidth: 1.5, borderColor: colors.accent,
  },
  photo: {
    width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: PHOTO_SIZE / 2,
  },
  photoFallback: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },

  name: {
    fontSize: 28, fontWeight: '300', color: colors.primary,
    letterSpacing: -0.5,
  },
  gradYear: {
    fontSize: 14, color: colors.secondary, marginTop: 4,
    marginBottom: spacing.md,
  },
  trigger: {
    fontSize: 15, color: colors.accent, textAlign: 'center',
    marginBottom: spacing.xl,
  },

  countdown: {
    fontSize: 13, color: colors.secondary,
    fontVariant: ['tabular-nums'],
    marginBottom: spacing.xl,
  },

  buttons: {
    flexDirection: 'row', gap: spacing.md,
  },
  skipBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center',
  },
  skipText: { fontSize: 16, color: colors.secondary },

  talkedBtn: {
    flex: 2, paddingVertical: 14, borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  talkedText: { fontSize: 16, color: colors.background, fontWeight: '500' },

  statusBlock: {
    alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm,
  },
  statusLabel: { fontSize: 16, color: colors.primary, fontWeight: '400' },
  statusSub:   { fontSize: 13, color: colors.secondary, textAlign: 'center' },

  closeBtn: {
    marginTop: spacing.md, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  closeBtnText: { fontSize: 14, color: colors.secondary },
});
