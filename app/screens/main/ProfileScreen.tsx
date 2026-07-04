import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { INTEREST_CATEGORIES } from '../../lib/interests';
import InterestPicker from '../../components/InterestPicker';
import WindowEditor from '../../components/WindowEditor';
import { DayWindow, defaultWeek, loadActiveWindows, saveActiveWindows } from '../../lib/activeWindowsStore';
import { colors, spacing } from '../../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Profile'>;
};

type ProfileData = {
  first_name: string;
  profile_photo_url: string | null;
  graduation_year: number | null;
  hometown_city: string;
  hometown_state: string;
  instagram_handle: string | null;
  phone_number: string | null;
};

const CURRENT_YEAR = new Date().getFullYear();
const GRAD_YEARS = [CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2, CURRENT_YEAR + 3, CURRENT_YEAR + 4];

export default function ProfileScreen({ navigation }: Props) {
  const { signOut } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [selectedInterests, setSelectedInterests] = useState<Set<string>>(new Set());
  const [windows, setWindows] = useState<DayWindow[]>(defaultWeek());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [profileRes, interestRes, windowsResult] = await Promise.all([
      supabase
        .from('users')
        .select('first_name, profile_photo_url, graduation_year, hometown_city, hometown_state, instagram_handle, phone_number')
        .eq('id', user.id)
        .single(),
      supabase
        .from('user_interests')
        .select('interests(label)')
        .eq('user_id', user.id),
      loadActiveWindows(user.id).catch((err) => {
        console.warn('[profile] failed to load active windows:', err?.message);
        return null;
      }),
    ]);

    if (profileRes.data) {
      setProfile(profileRes.data as ProfileData);
    }

    if (interestRes.data) {
      const labels = interestRes.data
        .map((row: any) => row.interests?.label)
        .filter(Boolean) as string[];
      setSelectedInterests(new Set(labels));
    }

    if (windowsResult) setWindows(windowsResult);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function pickAndUploadPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo access to change your profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const uri = result.assets[0].uri;

      // Read the file as base64 then decode to an ArrayBuffer. fetch().blob(),
      // .arrayBuffer() and File().bytes() all return empty data for file://
      // URIs in React Native, which uploads a 0-byte object that renders black.
      const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
      const arrayBuffer = decode(base64);
      if (arrayBuffer.byteLength === 0) throw new Error('Selected image is empty.');

      const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg';
      const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const path = `${user.id}/profile.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(path, arrayBuffer, { upsert: true, contentType });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(path);
      const cachedBustedUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from('users')
        .update({ profile_photo_url: cachedBustedUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setProfile((p) => p ? { ...p, profile_photo_url: cachedBustedUrl } : p);
    } catch (err: any) {
      Alert.alert('Upload failed', err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!profile) return;

    if (!profile.first_name.trim()) {
      Alert.alert('Required', 'First name cannot be empty.');
      return;
    }
    if (!profile.hometown_city.trim() || !profile.hometown_state.trim()) {
      Alert.alert('Required', 'Please enter both city and state.');
      return;
    }
    if (selectedInterests.size === 0) {
      Alert.alert('Required', 'Add at least one interest.');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Save basic profile fields
      const { error: profileErr } = await supabase
        .from('users')
        .update({
          first_name: profile.first_name.trim(),
          graduation_year: profile.graduation_year,
          hometown_city: profile.hometown_city.trim(),
          hometown_state: profile.hometown_state.trim(),
          instagram_handle: profile.instagram_handle?.trim().replace(/^@/, '') || null,
          phone_number: profile.phone_number?.trim() || null,
        })
        .eq('id', user.id);

      if (profileErr) throw profileErr;

      // Sync interests
      const labels = Array.from(selectedInterests);

      const { data: existingInterests, error: fetchErr } = await supabase
        .from('interests')
        .select('id, label')
        .in('label', labels);

      if (fetchErr) throw fetchErr;

      type InterestRow = { id: string; label: string };
      const existingLabels = new Set((existingInterests ?? []).map((i: InterestRow) => i.label));
      const newLabels = labels.filter((l) => !existingLabels.has(l));
      let allIds: string[] = (existingInterests ?? []).map((i: InterestRow) => i.id);

      if (newLabels.length > 0) {
        const newRows = newLabels.map((label) => ({
          label,
          category: INTEREST_CATEGORIES.find((c) => c.items.includes(label))?.label ?? 'Other',
        }));
        const { data: created, error: createErr } = await supabase
          .from('interests')
          .insert(newRows)
          .select('id');
        if (createErr) throw createErr;
        allIds = [...allIds, ...(created ?? []).map((i: { id: string }) => i.id)];
      }

      await supabase.from('user_interests').delete().eq('user_id', user.id);

      const { error: linkErr } = await supabase
        .from('user_interests')
        .insert(allIds.map((interest_id) => ({ user_id: user.id, interest_id })));

      if (linkErr) throw linkErr;

      // Sync active windows (validates ≥1 day enabled + no zero-length windows).
      await saveActiveWindows(user.id, windows);

      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: signOut,
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.secondary} />
      </View>
    );
  }

  if (!profile) return null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Photo */}
        <TouchableOpacity style={styles.photoRow} onPress={pickAndUploadPhoto} activeOpacity={0.8}>
          {profile.profile_photo_url ? (
            <Image source={{ uri: profile.profile_photo_url }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder} />
          )}
          <Text style={styles.photoChangeText}>Change photo</Text>
        </TouchableOpacity>

        <Divider />

        {/* Name */}
        <Section label="Name">
          <TextInput
            style={styles.input}
            value={profile.first_name}
            onChangeText={(v) => setProfile((p) => p ? { ...p, first_name: v } : p)}
            autoCapitalize="words"
            placeholderTextColor={colors.secondary}
          />
        </Section>

        <Divider />

        {/* Graduation year */}
        <Section label="Graduation year">
          <View style={styles.chipRow}>
            {GRAD_YEARS.map((year) => (
              <TouchableOpacity
                key={year}
                style={[styles.chip, profile.graduation_year === year && styles.chipSelected]}
                onPress={() => setProfile((p) => p ? { ...p, graduation_year: year } : p)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, profile.graduation_year === year && styles.chipTextSelected]}>
                  {`'${String(year).slice(2)}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        <Divider />

        {/* Hometown */}
        <Section label="Hometown">
          <TextInput
            style={styles.input}
            placeholder="City"
            placeholderTextColor={colors.secondary}
            value={profile.hometown_city}
            onChangeText={(v) => setProfile((p) => p ? { ...p, hometown_city: v } : p)}
            autoCapitalize="words"
          />
          <TextInput
            style={[styles.input, { marginTop: spacing.sm }]}
            placeholder="State"
            placeholderTextColor={colors.secondary}
            value={profile.hometown_state}
            onChangeText={(v) => setProfile((p) => p ? { ...p, hometown_state: v } : p)}
            autoCapitalize="words"
          />
        </Section>

        <Divider />

        {/* Interests */}
        <Section label="Interests">
          <InterestPicker selected={selectedInterests} onChange={setSelectedInterests} />
        </Section>

        <Divider />

        {/* Active windows */}
        <Section label="Active windows">
          <Text style={styles.contactNote}>
            Amici only runs during these windows. A window ending earlier than it starts (e.g. 10pm–2am) carries into the next day.
          </Text>
          <WindowEditor value={windows} onChange={setWindows} />
        </Section>

        <Divider />

        {/* Contact info */}
        <Section label="Contact info">
          <Text style={styles.contactNote}>
            Only shared after mutual confirmation. Never visible to others otherwise.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Instagram (optional)"
            placeholderTextColor={colors.secondary}
            value={profile.instagram_handle ?? ''}
            onChangeText={(v) => setProfile((p) => p ? { ...p, instagram_handle: v } : p)}
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, { marginTop: spacing.sm }]}
            placeholder="Phone number (optional)"
            placeholderTextColor={colors.secondary}
            value={profile.phone_number ?? ''}
            onChangeText={(v) => setProfile((p) => p ? { ...p, phone_number: v } : p)}
            keyboardType="phone-pad"
          />
        </Section>

        <Divider />

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOutRow} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  inner: { paddingBottom: 60 },

  photoRow: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  photo: { width: 96, height: 96, borderRadius: 48 },
  photoPlaceholder: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  photoChangeText: { color: colors.accent, fontSize: 14 },

  divider: { height: 1, backgroundColor: colors.border },

  section: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.sm },
  sectionLabel: { fontSize: 12, color: colors.secondary, textTransform: 'uppercase', letterSpacing: 1 },

  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.primary,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 20,
    paddingVertical: 7, paddingHorizontal: 13,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { fontSize: 14, color: colors.secondary },
  chipTextSelected: { color: colors.background },

  contactNote: { fontSize: 13, color: colors.secondary, lineHeight: 18, marginBottom: spacing.xs },

  saveButton: {
    backgroundColor: colors.primary, borderRadius: 10,
    paddingVertical: 15, alignItems: 'center',
    marginHorizontal: spacing.xl, marginTop: spacing.lg,
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: colors.background, fontSize: 16, fontWeight: '600' },

  signOutRow: { alignItems: 'center', paddingVertical: spacing.lg },
  signOutText: { color: colors.secondary, fontSize: 14 },
});
