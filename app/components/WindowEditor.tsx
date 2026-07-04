import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DAYS, DayWindow } from '../lib/activeWindowsStore';
import { formatTime12h } from '../lib/activeWindow';
import { colors, spacing } from '../lib/theme';

// Shared active-window editor used by onboarding and the Profile screen.
// Controlled: `value` is a length-7 DayWindow[] indexed by day_of_week; the
// parent owns persistence via saveActiveWindows so the two screens can't drift.

// 24 whole-hour options, 12am (midnight) through 11pm. Picking 12am as the end
// of a window means midnight — handled as a midnight-crossing window downstream.
const HOURS: { label: string; value: string }[] = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, '0')}:00:00`;
  const label =
    hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`;
  return { label, value };
});

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

function minutesOf(hhmmss: string): number {
  const [h, m] = hhmmss.split(':').map((n) => parseInt(n, 10));
  return h * 60 + m;
}

type Props = {
  value: DayWindow[];
  onChange: (next: DayWindow[]) => void;
};

export default function WindowEditor({ value, onChange }: Props) {
  function update(idx: number, patch: Partial<DayWindow>) {
    onChange(value.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  }

  return (
    <View>
      {DAYS.map((day, idx) => {
        const w = value[idx];
        const crosses = w.enabled && minutesOf(w.start) > minutesOf(w.end);
        const invalid = w.enabled && w.start === w.end;
        return (
          <View key={day} style={styles.dayRow}>
            <TouchableOpacity
              style={[styles.dayToggle, w.enabled && styles.dayToggleActive]}
              onPress={() => update(idx, { enabled: !w.enabled })}
              activeOpacity={0.8}
            >
              <Text style={[styles.dayLabel, w.enabled && styles.dayLabelActive]}>{day}</Text>
            </TouchableOpacity>

            {w.enabled ? (
              <View style={styles.timeCol}>
                <View style={styles.timeRow}>
                  <HourStepper value={w.start} onChange={(v) => update(idx, { start: v })} />
                  <Text style={styles.sep}>—</Text>
                  <HourStepper value={w.end} onChange={(v) => update(idx, { end: v })} />
                </View>
                {invalid ? (
                  <Text style={styles.warn}>Start and end can't be the same.</Text>
                ) : crosses ? (
                  <Text style={styles.note}>Ends {formatTime12h(w.end)} next day</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.offLabel}>Off</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function HourStepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const idx = Math.max(0, HOURS.findIndex((h) => h.value === value));
  const step = (dir: number) => onChange(HOURS[(idx + dir + HOURS.length) % HOURS.length].value);
  return (
    <View style={styles.stepper}>
      <TouchableOpacity onPress={() => step(-1)} style={styles.arrow} hitSlop={HIT} activeOpacity={0.6}>
        <Text style={styles.arrowText}>‹</Text>
      </TouchableOpacity>
      <Text style={styles.stepValue}>{HOURS[idx].label}</Text>
      <TouchableOpacity onPress={() => step(1)} style={styles.arrow} hitSlop={HIT} activeOpacity={0.6}>
        <Text style={styles.arrowText}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dayToggle: {
    width: 50,
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

  timeCol: { flex: 1, gap: spacing.xs },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sep: { color: colors.secondary, fontSize: 14 },
  note: { fontSize: 12, color: colors.accent },
  warn: { fontSize: 12, color: colors.error },
  offLabel: { flex: 1, fontSize: 13, color: colors.secondary },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.xs,
  },
  arrow: { paddingHorizontal: spacing.sm, paddingVertical: 6 },
  arrowText: { fontSize: 18, color: colors.secondary },
  stepValue: { minWidth: 46, textAlign: 'center', fontSize: 14, color: colors.primary },
});
