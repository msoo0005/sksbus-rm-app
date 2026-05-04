import { FontAwesome5 } from "@expo/vector-icons";
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type SegmentedTabsProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  tabs: { key: T; label: string; icon?: string }[];
};

export default function SegmentedTabs<T extends string>({
  value,
  onChange,
  tabs
}: SegmentedTabsProps<T>) {
  return (
    <View style={styles.container}>
      {tabs.map(tab => {
        const active = value === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, active && styles.activeTab]}
          >
            {tab.icon && (
              <FontAwesome5
                name={tab.icon}
                size={11}
                color={active ? "#000" : "#666"}
                style={{ marginRight: 5 }}
              />
            )}
            <Text style={[styles.text, active && styles.activeText]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#eee',
    borderRadius: 16,
    padding: 4,
    marginHorizontal: 16,
    marginVertical: 12,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
  },
  activeTab: {
    backgroundColor: '#fff',
  },
  text: {
    fontSize: 13,
    color: '#666',
  },
  activeText: {
    fontWeight: '600',
    color: '#000',
  },
});
