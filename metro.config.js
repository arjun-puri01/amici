const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Transform all Expo SDK packages (which ship TypeScript source), React Native
// packages, and @supabase (private class fields). The pattern uses expo(-[^/]*)?
// to cover both the bare "expo" package and every "expo-*" package (expo-keep-awake,
// expo-location, expo-notifications, etc.). Without this, Metro skips transforming
// those packages and Hermes fails on raw TypeScript.
config.transformer.transformIgnorePatterns = [
  'node_modules/(?!(expo(-[^/]*)?|@expo(-[^/]*)?/.*|react-native(-[^/]*)?|@react-native(-[^/]*)?/.*|@supabase/.*))',
];

module.exports = config;
