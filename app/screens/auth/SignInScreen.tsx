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
  navigation: NativeStackNavigationProp<RootStackParamList, 'SignIn'>;
};

export default function SignInScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !password) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });
    setLoading(false);

    if (error) {
      Alert.alert('Sign in failed', error.message);
    }
    // On success, the auth state listener in App.tsx navigates to Main
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Welcome back</Text>

        <TextInput
          style={styles.input}
          placeholder="College email"
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
          placeholder="Password"
          placeholderTextColor={colors.secondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => navigation.navigate('SignUp')}
        >
          <Text style={styles.linkText}>Don't have an account? Sign up</Text>
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
    fontSize: 28,
    color: colors.primary,
    fontWeight: '600',
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
