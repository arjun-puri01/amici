import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INTEREST_CATEGORIES } from '../lib/interests';
import { colors, spacing } from '../lib/theme';

// Shared interest picker used by both the onboarding interests step and the
// Profile interests editor so they stay identical.
//
// Selection is controlled by the parent and stored as a Set of interest LABELS.
// There is no notion of a selected "category" — checking a category header
// simply selects/deselects all of its child labels. The parent resolves these
// labels to individual user_interests rows on save.

type Props = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
};

type CheckState = 'empty' | 'checked' | 'partial';

export default function InterestPicker({ selected, onChange }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(category: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(category) ? next.delete(category) : next.add(category);
      return next;
    });
  }

  function toggleItem(label: string) {
    const next = new Set(selected);
    next.has(label) ? next.delete(label) : next.add(label);
    onChange(next);
  }

  function categoryState(items: string[]): CheckState {
    const count = items.filter((i) => selected.has(i)).length;
    if (count === 0) return 'empty';
    if (count === items.length) return 'checked';
    return 'partial';
  }

  // Header checkbox: if everything is already selected, clear the category;
  // otherwise (none or some selected) select all of it.
  function toggleCategory(items: string[]) {
    const next = new Set(selected);
    if (categoryState(items) === 'checked') {
      items.forEach((i) => next.delete(i));
    } else {
      items.forEach((i) => next.add(i));
    }
    onChange(next);
  }

  return (
    <View>
      {INTEREST_CATEGORIES.map((category) => {
        const isOpen = expanded.has(category.label);
        const state = categoryState(category.items);
        const count = category.items.filter((i) => selected.has(i)).length;

        return (
          <View key={category.label} style={styles.category}>
            <View style={styles.header}>
              {/* Select-all checkbox — independent tap target from the header */}
              <TouchableOpacity
                onPress={() => toggleCategory(category.items)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
                activeOpacity={0.7}
              >
                <Checkbox state={state} />
              </TouchableOpacity>

              {/* Rest of the header expands / collapses the category */}
              <TouchableOpacity
                style={styles.headerLabelArea}
                onPress={() => toggleExpanded(category.label)}
                activeOpacity={0.7}
              >
                <Text style={styles.headerLabel}>{category.label}</Text>
                <View style={styles.headerRight}>
                  {count > 0 && <Text style={styles.count}>{count}</Text>}
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.secondary}
                  />
                </View>
              </TouchableOpacity>
            </View>

            {isOpen && (
              <View style={styles.items}>
                {category.items.map((item) => {
                  const on = selected.has(item);
                  return (
                    <TouchableOpacity
                      key={item}
                      style={styles.itemRow}
                      onPress={() => toggleItem(item)}
                      activeOpacity={0.7}
                    >
                      <Checkbox state={on ? 'checked' : 'empty'} />
                      <Text style={[styles.itemText, on && styles.itemTextOn]}>
                        {item}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// Three-state checkbox: empty (outline), checked (filled + check), and a
// visually distinct partial state (accent fill + minus) for "some selected".
function Checkbox({ state }: { state: CheckState }) {
  if (state === 'checked') {
    return (
      <View style={[styles.checkbox, styles.checkboxChecked]}>
        <Ionicons name="checkmark" size={15} color={colors.background} />
      </View>
    );
  }
  if (state === 'partial') {
    return (
      <View style={[styles.checkbox, styles.checkboxPartial]}>
        <Ionicons name="remove" size={15} color={colors.background} />
      </View>
    );
  }
  return <View style={[styles.checkbox, styles.checkboxEmpty]} />;
}

const styles = StyleSheet.create({
  category: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  headerLabelArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: { fontSize: 16, color: colors.primary, fontWeight: '500' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  count: { fontSize: 13, color: colors.accent },

  items: {
    paddingLeft: 34, // indent under the header checkbox
    paddingBottom: spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  itemText: { fontSize: 15, color: colors.secondary, flex: 1 },
  itemTextOn: { color: colors.primary },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxEmpty: {
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  checkboxChecked: { backgroundColor: colors.primary },
  checkboxPartial: { backgroundColor: colors.accent },
});
