import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type TabKey = 'pending' | 'open' | 'closed' ;

type SegmentedTabsProps = {
  value: TabKey;
  onChange: (value: TabKey) => void;
  tabs: { key: TabKey; label: string }[];
};

export default function SegmentedTabs({ value, onChange, tabs }: SegmentedTabsProps) {
  return (
    <View style={styles.container}>
      {tabs.map(tab => (
        <Pressable
          key={tab.key}
          onPress={() => onChange(tab.key)}
          style={[
            styles.tab,
            value === tab.key && styles.activeTab,
          ]}
        >
          <Text style={[
            styles.text,
            value === tab.key && styles.activeText,
          ]}>
            {tab.label}
          </Text>
        </Pressable>
      ))}
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
    flex: 1, // make all tabs equal width
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
