import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { supabase } from '../../lib/supabase';
import { INTEREST_CATEGORIES } from '../../lib/interests';
import InterestPicker from '../../components/InterestPicker';
import { colors, spacing } from '../../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'OnboardingInterests'>;
};

export default function OnboardingInterestsScreen({ navigation }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  async function handleNext() {
    if (selected.size === 0) {
      Alert.alert('Add at least one interest', 'Interests are how Amici finds shared connections.');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Upsert interests into the interests table, then link them to the user
      const labels = Array.from(selected);

      // Find or create each interest
      const { data: existingInterests, error: fetchErr } = await supabase
        .from('interests')
        .select('id, label')
        .in('label', labels);

      if (fetchErr) throw fetchErr;

      const existingLabels = new Set((existingInterests ?? []).map((i) => i.label));
      const newLabels = labels.filter((l) => !existingLabels.has(l));

      let allInterestIds: string[] = (existingInterests ?? []).map((i) => i.id);

      if (newLabels.length > 0) {
        // Determine category for each new label
        const newRows = newLabels.map((label) => {
          const category = INTEREST_CATEGORIES.find((c) =>
            c.items.includes(label)
          )?.label ?? 'Other';
          return { label, category };
        });

        const { data: created, error: createErr } = await supabase
          .from('interests')
          .insert(newRows)
          .select('id');

        if (createErr) throw createErr;
        allInterestIds = [...allInterestIds, ...(created ?? []).map((i) => i.id)];
      }

      // Delete old user_interests and replace with current selection
      await supabase.from('user_interests').delete().eq('user_id', user.id);

      const userInterestRows = allInterestIds.map((interest_id) => ({
        user_id: user.id,
        interest_id,
      }));

      const { error: linkErr } = await supabase
        .from('user_interests')
        .insert(userInterestRows);

      if (linkErr) throw linkErr;

      navigation.navigate('OnboardingWindows');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.inner}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.step}>4 of 5</Text>
        <Text style={styles.title}>What are you into?</Text>
        <Text style={styles.subtitle}>
          Pick anything that genuinely applies. The more specific, the better the match.
        </Text>

        <InterestPicker selected={selected} onChange={setSelected} />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.buttonText}>
              {selected.size > 0 ? `Continue (${selected.size} selected)` : 'Continue'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
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
  step: { fontSize: 13, color: colors.secondary },
  title: { fontSize: 28, color: colors.primary, fontWeight: '600', marginBottom: spacing.xs },
  subtitle: { fontSize: 15, color: colors.secondary, lineHeight: 22, marginBottom: spacing.lg },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '600' },
});
