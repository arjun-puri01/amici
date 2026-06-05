import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';

import { useAuth } from './lib/AuthContext';
import { RootStackParamList } from './types';
import { colors } from './lib/theme';

// Auth
import SignUpScreen from './screens/auth/SignUpScreen';
import SignInScreen from './screens/auth/SignInScreen';

// Onboarding
import OnboardingPhotoScreen from './screens/auth/OnboardingPhotoScreen';
import OnboardingGradYearScreen from './screens/auth/OnboardingGradYearScreen';
import OnboardingHometownScreen from './screens/auth/OnboardingHometownScreen';
import OnboardingInterestsScreen from './screens/auth/OnboardingInterestsScreen';
import OnboardingWindowsScreen from './screens/auth/OnboardingWindowsScreen';
import OnboardingContactScreen from './screens/auth/OnboardingContactScreen';

// Main
import HomeScreen from './screens/main/HomeScreen';
import ProfileScreen from './screens/main/ProfileScreen';
import MatchScreen from './screens/main/MatchScreen';
import ShareScreen from './screens/main/ShareScreen';
import HistoryScreen from './screens/main/HistoryScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.primary,
    border: colors.border,
  },
};

export default function Navigation() {
  const { auth } = useAuth();
  const navRef = useNavigationContainerRef<RootStackParamList>();

  // ── Notification tap → MatchModal ─────────────────────────────────────────

  // Foreground/background: fires each time the user taps a notification.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data ?? {};
      const matchId      = data.matchId      as string | undefined;
      const connectionId = data.connectionId as string | undefined;
      const type         = data.type         as string | undefined;

      if (connectionId && matchId && type === 'confirmed') {
        navRef.current?.navigate('ShareModal', { matchId, connectionId });
      } else if (matchId) {
        navRef.current?.navigate('MatchModal', { matchId });
      }
    });
    return () => sub.remove();
  }, [navRef]);

  // Killed-state launch: the response is stored by Expo; handle it once auth resolves.
  const handledInitial = useRef(false);
  useEffect(() => {
    if (auth.status !== 'signed_in' || handledInitial.current) return;
    handledInitial.current = true;
    Notifications.getLastNotificationResponseAsync().then(response => {
      const data = response?.notification?.request?.content?.data ?? {};
      const matchId      = data.matchId      as string | undefined;
      const connectionId = data.connectionId as string | undefined;
      const type         = data.type         as string | undefined;

      if (connectionId && matchId && type === 'confirmed') {
        navRef.current?.navigate('ShareModal', { matchId, connectionId });
      } else if (matchId) {
        navRef.current?.navigate('MatchModal', { matchId });
      }
    });
  }, [auth.status, navRef]);

  // ─────────────────────────────────────────────────────────────────────────

  if (auth.status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.secondary} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navRef} theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {auth.status === 'signed_out' ? (
          // Auth stack
          <>
            <Stack.Screen name="SignUp" component={SignUpScreen} />
            <Stack.Screen name="SignIn" component={SignInScreen} />
          </>
        ) : !auth.onboarded ? (
          // Onboarding stack
          <>
            <Stack.Screen name="OnboardingPhoto" component={OnboardingPhotoScreen} />
            <Stack.Screen name="OnboardingGradYear" component={OnboardingGradYearScreen} />
            <Stack.Screen name="OnboardingHometown" component={OnboardingHometownScreen} />
            <Stack.Screen name="OnboardingInterests" component={OnboardingInterestsScreen} />
            <Stack.Screen name="OnboardingWindows" component={OnboardingWindowsScreen} />
            <Stack.Screen name="OnboardingContact" component={OnboardingContactScreen} />
          </>
        ) : (
          // Main app stack
          <>
            <Stack.Screen name="Main" component={HomeScreen} />
            <Stack.Screen
              name="History"
              component={HistoryScreen}
              options={{
                headerShown: true,
                title: 'History',
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.primary,
                headerShadowVisible: false,
                headerBackTitle: '',
              }}
            />
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={{
                headerShown: true,
                title: 'Profile',
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.primary,
                headerShadowVisible: false,
                headerBackTitle: '',
              }}
            />
            <Stack.Screen
              name="MatchModal"
              component={MatchScreen}
              options={{
                headerShown: false,
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="ShareModal"
              component={ShareScreen}
              options={{
                headerShown: false,
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
