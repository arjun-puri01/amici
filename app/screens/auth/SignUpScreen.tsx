import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'SignUp'>;
};

export default function SignUpScreen({ navigation }: Props) {
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  function isEduEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.edu$/i.test(value.trim());
  }

  async function handleSignUp() {
    const trimmedName = firstName.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      Alert.alert('Required', 'Please enter your first name.');
      return;
    }

    if (!isEduEmail(trimmedEmail)) {
      Alert.alert('Invalid email', 'Please use your .edu college email address.');
      return;
    }

    if (password.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: { data: { first_name: trimmedName } },
    });
    setLoading(false);

    if (error) {
      Alert.alert('Sign up failed', error.message);
      return;
    }

    // If a session came back immediately, email confirmation is disabled.
    // The auth state listener in Navigation.tsx will route to onboarding — do nothing here.
    // If no session, email confirmation is required.
    if (!data.session) {
      Alert.alert(
        'Check your inbox',
        `We sent a confirmation link to ${trimmedEmail}. Confirm your email, then sign in.`
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Amici</Text>
        <Text style={styles.subtitle}>
          Meet people nearby who share something real with you.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="First name"
          placeholderTextColor={colors.secondary}
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          textContentType="givenName"
        />

        <TextInput
          style={styles.input}
          placeholder="College email (.edu)"
          placeholderTextColor={colors.secondary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />

        <TextInput
          style={styles.input}
          placeholder="Password (8+ characters)"
          placeholderTextColor={colors.secondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignUp}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.buttonText}>Create account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => navigation.navigate('SignIn')}
        >
          <Text style={styles.linkText}>Already have an account? Sign in</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: 36,
    color: colors.primary,
    fontWeight: '600',
    letterSpacing: -0.5,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 15,
    color: colors.secondary,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
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
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
  },
  linkRow: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  linkText: {
    color: colors.secondary,
    fontSize: 14,
  },
});
