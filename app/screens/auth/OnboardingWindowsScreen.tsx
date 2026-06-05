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
import { colors, spacing } from '../../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'OnboardingWindows'>;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Simple hour picker — full hour increments, 6am–midnight
const HOURS: { label: string; value: string }[] = Array.from({ length: 19 }, (_, i) => {
  const h = i + 6; // 6 through 24 (midnight)
  const hour = h === 24 ? 0 : h;
  const ampm = hour < 12 ? 'am' : 'pm';
  const display = hour === 0 ? '12am' : hour <= 12 ? `${hour}${ampm}` : `${hour - 12}${ampm}`;
  const pad = String(hour).padStart(2, '0');
  return { label: display, value: `${pad}:00:00` };
});

type DayWindow = {
  enabled: boolean;
  start: string; // HH:MM:SS
  end: string;
};

// Default: Mon–Sun, 10am–10pm
const defaultWindow: DayWindow = { enabled: true, start: '10:00:00', end: '22:00:00' };

export default function OnboardingWindowsScreen({ navigation }: Props) {
  const [windows, setWindows] = useState<DayWindow[]>(
    DAYS.map(() => ({ ...defaultWindow }))
  );
  const [loading, setLoading] = useState(false);

  function toggleDay(idx: number) {
    setWindows((prev) =>
      prev.map((w, i) => (i === idx ? { ...w, enabled: !w.enabled } : w))
    );
  }

  function setStart(idx: number, value: string) {
    setWindows((prev) =>
      prev.map((w, i) => (i === idx ? { ...w, start: value } : w))
    );
  }

  function setEnd(idx: number, value: string) {
    setWindows((prev) =>
      prev.map((w, i) => (i === idx ? { ...w, end: value } : w))
    );
  }

  function hourLabel(value: string): string {
    return HOURS.find((h) => h.value === value)?.label ?? value;
  }

  async function handleNext() {
    const enabledDays = windows.filter((w) => w.enabled);
    if (enabledDays.length === 0) {
      Alert.alert('At least one day required', 'Enable at least one day for active windows.');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Delete old windows and replace
      await supabase.from('active_windows').delete().eq('user_id', user.id);

      const rows = windows
        .map((w, day_of_week) => ({ user_id: user.id, day_of_week, start_time: w.start, end_time: w.end, enabled: w.enabled }))
        .filter((r) => r.enabled)
        .map(({ user_id, day_of_week, start_time, end_time }) => ({ user_id, day_of_week, start_time, end_time }));

      const { error } = await supabase.from('active_windows').insert(rows);
      if (error) throw error;

      navigation.navigate('OnboardingContact');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.inner} showsVerticalScrollIndicator={false}>
        <Text style={styles.step}>5 of 5</Text>
        <Text style={styles.title}>When should Amici listen?</Text>
        <Text style={styles.subtitle}>
          Amici only runs during these windows. Outside them, it does nothing and uses no battery.
        </Text>

        {DAYS.map((day, idx) => (
          <View key={day} style={styles.dayRow}>
            <TouchableOpacity
              style={[styles.dayToggle, windows[idx].enabled && styles.dayToggleActive]}
              onPress={() => toggleDay(idx)}
              activeOpacity={0.8}
            >
              <Text style={[styles.dayLabel, windows[idx].enabled && styles.dayLabelActive]}>
                {day}
              </Text>
            </TouchableOpacity>

            {windows[idx].enabled && (
              <View style={styles.timeRow}>
                <HourPicker
                  label="From"
                  value={windows[idx].start}
                  onSelect={(v) => setStart(idx, v)}
                  hourLabel={hourLabel}
                />
                <Text style={styles.timeSep}>—</Text>
                <HourPicker
                  label="To"
                  value={windows[idx].end}
                  onSelect={(v) => setEnd(idx, v)}
                  hourLabel={hourLabel}
                />
              </View>
            )}
          </View>
        ))}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// Inline minimal hour picker — cycles through HOURS on tap
function HourPicker({
  value,
  onSelect,
  hourLabel,
}: {
  label: string;
  value: string;
  onSelect: (v: string) => void;
  hourLabel: (v: string) => string;
}) {
  const currentIdx = HOURS.findIndex((h) => h.value === value);

  function increment() {
    const next = (currentIdx + 1) % HOURS.length;
    onSelect(HOURS[next].value);
  }

  function decrement() {
    const prev = (currentIdx - 1 + HOURS.length) % HOURS.length;
    onSelect(HOURS[prev].value);
  }

  return (
    <View style={pickerStyles.row}>
      <TouchableOpacity onPress={decrement} style={pickerStyles.arrow}>
        <Text style={pickerStyles.arrowText}>‹</Text>
      </TouchableOpacity>
      <Text style={pickerStyles.value}>{hourLabel(value)}</Text>
      <TouchableOpacity onPress={increment} style={pickerStyles.arrow}>
        <Text style={pickerStyles.arrowText}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: { paddingHorizontal: spacing.xl, paddingTop: 80, paddingBottom: spacing.xl, gap: spacing.md },
  step: { fontSize: 13, color: colors.secondary },
  title: { fontSize: 28, color: colors.primary, fontWeight: '600', marginBottom: spacing.xs },
  subtitle: { fontSize: 15, color: colors.secondary, lineHeight: 22, marginBottom: spacing.sm },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  dayToggle: {
    width: 52,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  dayToggleActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  dayLabel: { fontSize: 14, color: colors.secondary, fontWeight: '500' },
  dayLabelActive: { color: colors.background },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  timeSep: { color: colors.secondary, fontSize: 14 },
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

const pickerStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  arrow: { padding: 4 },
  arrowText: { color: colors.secondary, fontSize: 20 },
  value: { color: colors.primary, fontSize: 14, minWidth: 40, textAlign: 'center' },
});
