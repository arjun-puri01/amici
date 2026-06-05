import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { colors, spacing } from '../../lib/theme';

export default function OnboardingContactScreen() {
  const { refreshOnboarded } = useAuth();
  const [instagram, setInstagram] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleFinish() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const update: Record<string, string | null> = {
        instagram_handle: instagram.trim().replace(/^@/, '') || null,
        phone_number: phone.trim() || null,
      };

      const { error } = await supabase.from('users').update(update).eq('id', user.id);
      if (error) throw error;

      // Directly re-query onboarded state — reliable, no dependency on Supabase event timing.
      await refreshOnboarded();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.tag}>Optional</Text>
        <Text style={styles.title}>Add contact info</Text>
        <Text style={styles.subtitle}>
          This is stored securely and is never shared unless you both confirm you talked and both choose to share it. You can always add or edit this later.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Instagram</Text>
          <TextInput
            style={styles.input}
            placeholder="@handle"
            placeholderTextColor={colors.secondary}
            value={instagram}
            onChangeText={setInstagram}
            autoCapitalize="none"
            autoComplete="username"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Phone number</Text>
          <TextInput
            style={styles.input}
            placeholder="(555) 000-0000"
            placeholderTextColor={colors.secondary}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
          />
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleFinish}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.buttonText}>Done — let's go</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipRow}
          onPress={handleFinish}
        >
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: {
    paddingHorizontal: spacing.xl,
    paddingTop: 80,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  tag: { fontSize: 12, color: colors.accent, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 28, color: colors.primary, fontWeight: '600', marginBottom: spacing.xs },
  subtitle: { fontSize: 15, color: colors.secondary, lineHeight: 22, marginBottom: spacing.lg },
  inputGroup: { gap: spacing.xs },
  inputLabel: { fontSize: 13, color: colors.secondary },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.primary,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '600' },
  skipRow: { alignItems: 'center', paddingVertical: spacing.sm },
  skipText: { color: colors.secondary, fontSize: 14 },
});
