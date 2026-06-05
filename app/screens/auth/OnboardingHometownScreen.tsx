import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'OnboardingHometown'>;
};

export default function OnboardingHometownScreen({ navigation }: Props) {
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleNext() {
    const trimCity = city.trim();
    const trimState = state.trim();

    if (!trimCity || !trimState) {
      Alert.alert('Required', 'Please enter both city and state.');
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { error } = await supabase
      .from('users')
      .update({ hometown_city: trimCity, hometown_state: trimState })
      .eq('id', user.id);

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    navigation.navigate('OnboardingInterests');
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.step}>3 of 5</Text>
        <Text style={styles.title}>Where are you from?</Text>
        <Text style={styles.subtitle}>
          This is one of the primary ways Amici finds connections. Be specific.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="City"
          placeholderTextColor={colors.secondary}
          value={city}
          onChangeText={setCity}
          autoCapitalize="words"
          returnKeyType="next"
        />

        <TextInput
          style={styles.input}
          placeholder="State (e.g. Texas)"
          placeholderTextColor={colors.secondary}
          value={state}
          onChangeText={setState}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={handleNext}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 80,
    gap: spacing.md,
  },
  step: { fontSize: 13, color: colors.secondary },
  title: { fontSize: 28, color: colors.primary, fontWeight: '600', marginBottom: spacing.xs },
  subtitle: { fontSize: 15, color: colors.secondary, lineHeight: 22, marginBottom: spacing.lg },
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
});
