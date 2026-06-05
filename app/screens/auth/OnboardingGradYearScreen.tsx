import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'OnboardingGradYear'>;
};

const CURRENT_YEAR = new Date().getFullYear();
const GRAD_YEARS = [
  CURRENT_YEAR,
  CURRENT_YEAR + 1,
  CURRENT_YEAR + 2,
  CURRENT_YEAR + 3,
  CURRENT_YEAR + 4,
];

export default function OnboardingGradYearScreen({ navigation }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleNext() {
    if (!selected) {
      Alert.alert('Required', 'Please select your graduation year.');
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { error } = await supabase
      .from('users')
      .update({ graduation_year: selected })
      .eq('id', user.id);

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    navigation.navigate('OnboardingHometown');
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.inner}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.step}>2 of 5</Text>
      <Text style={styles.title}>When do you graduate?</Text>
      <Text style={styles.subtitle}>This appears on your match card.</Text>

      <View style={styles.options}>
        {GRAD_YEARS.map((year) => (
          <TouchableOpacity
            key={year}
            style={[styles.option, selected === year && styles.optionSelected]}
            onPress={() => setSelected(year)}
            activeOpacity={0.8}
          >
            <Text style={[styles.optionText, selected === year && styles.optionTextSelected]}>
              {`'${String(year).slice(2)}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleNext}
        disabled={loading}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>Continue</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: {
    paddingHorizontal: spacing.xl,
    paddingTop: 80,
    gap: spacing.md,
    flexGrow: 1,
  },
  step: { fontSize: 13, color: colors.secondary },
  title: { fontSize: 28, color: colors.primary, fontWeight: '600', marginBottom: spacing.xs },
  subtitle: { fontSize: 15, color: colors.secondary, lineHeight: 22, marginBottom: spacing.lg },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  optionText: { fontSize: 17, color: colors.secondary, fontWeight: '500' },
  optionTextSelected: { color: colors.background },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '600' },
});
