import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
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
  navigation: NativeStackNavigationProp<RootStackParamList, 'ShareModal'>;
  route: RouteProp<RootStackParamList, 'ShareModal'>;
};

type ShareResult = {
  submitted: boolean;
  waiting: boolean;
  contact: { instagram_handle: string | null; phone_number: string | null } | null;
};

type Phase = 'loading' | 'choosing' | 'waiting' | 'revealed';

export default function ShareScreen({ navigation, route }: Props) {
  const { connectionId } = route.params;

  const [phase, setPhase]               = useState<Phase>('loading');
  const [shareInstagram, setShareInstagram] = useState(true);
  const [sharePhone, setSharePhone]     = useState(true);
  const [contact, setContact]           = useState<ShareResult['contact']>(null);
  const [otherName, setOtherName]       = useState('');
  const [submitting, setSubmitting]     = useState(false);

  // Keep latest share choices in a ref so the realtime callback can read them
  const choicesRef = useRef({ share_instagram: true, share_phone: true });
  useEffect(() => {
    choicesRef.current = { share_instagram: shareInstagram, share_phone: sharePhone };
  }, [shareInstagram, sharePhone]);

  // ── Load initial state ────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigation.goBack(); return; }

    // Fetch the connection to find the other user's name
    const { data: conn } = await supabase
      .from('connections')
      .select('user_id_1, user_id_2, shared_at_1, shared_at_2')
      .eq('id', connectionId)
      .single();

    if (!conn) { navigation.goBack(); return; }

    const otherId = conn.user_id_1 === user.id ? conn.user_id_2 : conn.user_id_1;
    const { data: other } = await supabase
      .from('users')
      .select('first_name')
      .eq('id', otherId)
      .single();

    setOtherName(other?.first_name ?? '');

    // Check if this user has already submitted in a prior session
    const isUser1     = conn.user_id_1 === user.id;
    const mySharedAt  = isUser1 ? conn.shared_at_1 : conn.shared_at_2;

    if (mySharedAt) {
      // Already submitted — re-call handle-share to check for revealed contact info
      await callShare(choicesRef.current.share_instagram, choicesRef.current.share_phone);
    } else {
      setPhase('choosing');
    }
  }, [connectionId, navigation]);

  useEffect(() => { load(); }, [load]);

  // ── Realtime: watch for the other user submitting ─────────────────────────

  useEffect(() => {
    const channel = supabase
      .channel(`share:${connectionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'connections', filter: `id=eq.${connectionId}` },
        () => {
          // Other user submitted their choices — re-call handle-share to get contact info
          callShare(choicesRef.current.share_instagram, choicesRef.current.share_phone);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [connectionId]);

  // ── Core: submit / poll via edge function ─────────────────────────────────

  async function callShare(instagram: boolean, phone: boolean): Promise<void> {
    const { data, error } = await supabase.functions.invoke<ShareResult>('handle-share', {
      body: { connection_id: connectionId, share_instagram: instagram, share_phone: phone },
    });
    if (error || !data) return;

    if (!data.waiting && data.contact !== null) {
      setContact(data.contact);
      setPhase('revealed');
    } else {
      setPhase('waiting');
    }
  }

  async function handleShare() {
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke<ShareResult>('handle-share', {
      body: {
        connection_id: connectionId,
        share_instagram: shareInstagram,
        share_phone: sharePhone,
      },
    });
    setSubmitting(false);

    if (error || !data) {
      Alert.alert('Something went wrong', error?.message ?? 'Please try again');
      return;
    }

    if (!data.waiting && data.contact !== null) {
      setContact(data.contact);
      setPhase('revealed');
    } else {
      setPhase('waiting');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.secondary} />
      </View>
    );
  }

  const hasAnything = contact && (contact.instagram_handle || contact.phone_number);
  const sharedNothing = contact && !contact.instagram_handle && !contact.phone_number;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.close}
        onPress={() => navigation.goBack()}
        activeOpacity={0.6}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.closeLabel}>Done</Text>
      </TouchableOpacity>

      <View style={styles.body}>
        {phase === 'choosing' && (
          <>
            <Text style={styles.heading}>Connect with {otherName}</Text>
            <Text style={styles.sub}>
              Choose what to share. {otherName} will see it once they share too.
            </Text>

            <View style={styles.toggles}>
              <View style={styles.toggleRow}>
                <View>
                  <Text style={styles.toggleLabel}>Instagram</Text>
                  <Text style={styles.toggleSub}>@handle</Text>
                </View>
                <Switch
                  value={shareInstagram}
                  onValueChange={setShareInstagram}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor={colors.primary}
                />
              </View>

              <View style={[styles.toggleRow, styles.toggleRowLast]}>
                <View>
                  <Text style={styles.toggleLabel}>Phone number</Text>
                  <Text style={styles.toggleSub}>SMS / iMessage</Text>
                </View>
                <Switch
                  value={sharePhone}
                  onValueChange={setSharePhone}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor={colors.primary}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.shareBtn, !shareInstagram && !sharePhone && styles.shareBtnMuted]}
              onPress={handleShare}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting
                ? <ActivityIndicator color={colors.background} size="small" />
                : <Text style={styles.shareBtnText}>
                    {shareInstagram || sharePhone ? 'Share' : 'Skip sharing'}
                  </Text>
              }
            </TouchableOpacity>
          </>
        )}

        {phase === 'waiting' && (
          <>
            <Text style={styles.heading}>Shared!</Text>
            <Text style={styles.sub}>
              Waiting for {otherName} to share their info…
            </Text>
            <ActivityIndicator color={colors.secondary} style={{ marginTop: spacing.xl }} />
          </>
        )}

        {phase === 'revealed' && (
          <>
            <Text style={styles.heading}>
              {hasAnything ? `You're connected!` : `You connected`}
            </Text>

            {sharedNothing && (
              <Text style={styles.sub}>
                {otherName} didn't share contact info this time.
              </Text>
            )}

            {contact?.instagram_handle && (
              <View style={styles.contactRow}>
                <Text style={styles.contactLabel}>Instagram</Text>
                <Text style={styles.contactValue}>@{contact.instagram_handle}</Text>
              </View>
            )}

            {contact?.phone_number && (
              <View style={styles.contactRow}>
                <Text style={styles.contactLabel}>Phone</Text>
                <Text style={styles.contactValue}>{contact.phone_number}</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },

  container: { flex: 1, backgroundColor: colors.background },

  close: {
    position: 'absolute', top: 56, right: spacing.xl,
    zIndex: 10,
  },
  closeLabel: { fontSize: 14, color: colors.secondary },

  body: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },

  heading: {
    fontSize: 26, fontWeight: '300', color: colors.primary,
    letterSpacing: -0.5, textAlign: 'center',
    marginBottom: spacing.sm,
  },
  sub: {
    fontSize: 14, color: colors.secondary, textAlign: 'center',
    lineHeight: 20, marginBottom: spacing.xl,
  },

  toggles: {
    width: '100%',
    borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    backgroundColor: colors.surface,
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  toggleRowLast: { borderBottomWidth: 0 },
  toggleLabel: { fontSize: 15, color: colors.primary },
  toggleSub:   { fontSize: 12, color: colors.secondary, marginTop: 2 },

  shareBtn: {
    width: '100%', paddingVertical: 14, borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  shareBtnMuted: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  shareBtnText: { fontSize: 16, color: colors.background, fontWeight: '500' },

  contactRow: {
    width: '100%', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  contactLabel: { fontSize: 14, color: colors.secondary },
  contactValue: { fontSize: 15, color: colors.primary, fontWeight: '400' },

  doneBtn: {
    marginTop: spacing.xl, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  doneBtnText: { fontSize: 14, color: colors.secondary },
});
