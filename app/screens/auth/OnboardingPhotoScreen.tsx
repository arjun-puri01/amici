import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'OnboardingPhoto'>;
};

export default function OnboardingPhotoScreen({ navigation }: Props) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo access to set a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  async function handleNext() {
    if (!imageUri) {
      Alert.alert('Photo required', 'Please add a profile photo so people can find you.');
      return;
    }

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const response = await fetch(imageUri);
      const blob = await response.blob();
      const ext = imageUri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg';
      const path = `${user.id}/profile.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(path, blob, { upsert: true, contentType: `image/${ext}` });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(path);

      const { error: updateError } = await supabase
        .from('users')
        .update({ profile_photo_url: urlData.publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      navigation.navigate('OnboardingGradYear');
    } catch (err: any) {
      Alert.alert('Upload failed', err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.step}>1 of 5</Text>
        <Text style={styles.title}>Add a photo</Text>
        <Text style={styles.subtitle}>
          This is how people will recognize you when they get a match notification.
        </Text>

        <TouchableOpacity style={styles.photoArea} onPress={pickImage} activeOpacity={0.8}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.photo} />
          ) : (
            <Text style={styles.photoPlaceholder}>Tap to choose</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, uploading && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={uploading}
          activeOpacity={0.8}
        >
          {uploading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
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
  photoArea: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  photo: { width: 140, height: 140, borderRadius: 70 },
  photoPlaceholder: { color: colors.secondary, fontSize: 14 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '600' },
});
