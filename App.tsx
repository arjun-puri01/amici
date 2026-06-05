import 'react-native-url-polyfill/auto';
// Background task must be defined before the app renders — keep this import first.
import './app/lib/backgroundTask';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { AuthProvider } from './app/lib/AuthContext';
import Navigation from './app/Navigation';

// Show notifications as banners even when the app is foregrounded.
// Tap handling (navigating to the Match Screen) is wired in step 7.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Navigation />
    </AuthProvider>
  );
}
