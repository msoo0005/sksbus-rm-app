import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PartUsed } from '../types/report';

export type PartCatalogItem = {
  id: number;
  name: string;
  code: string;
  stock: number;
};

type Props = {
  catalog: PartCatalogItem[];
  value: PartUsed[];
  onChange: (next: PartUsed[]) => void;
};

export default function PartsUsedCard({ catalog, value, onChange }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
    );
  }, [catalog, query]);

  const selectedQtyById = useMemo(() => {
    const map = new Map<number, number>();
    value.forEach(v => map.set(v.id, v.qty));
    return map;
  }, [value]);

  const addPart = (part: PartCatalogItem) => {
    if (part.stock <= 0) return;

    const existing = value.find(v => v.id === part.id);
    if (existing) {
      // (Optional) cap to stock so you can't exceed stock
      const nextQty = Math.min(existing.qty + 1, part.stock);
      onChange(value.map(v => (v.id === part.id ? { ...v, qty: nextQty } : v)));
      return;
    }

    onChange([...value, { id: part.id, name: part.name, code: part.code, qty: 1 }]);
  };

  const decrementPart = (id: number) => {
    const existing = value.find(v => v.id === id);
    if (!existing) return;

    if (existing.qty <= 1) {
      // drop to 0 -> remove
      onChange(value.filter(v => v.id !== id));
      return;
    }

    onChange(value.map(v => (v.id === id ? { ...v, qty: v.qty - 1 } : v)));
  };

  const removePart = (id: number) => {
    onChange(value.filter(v => v.id !== id));
  };

  const visibleRows = filtered.slice(0, 8);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Parts Used</Text>

      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search parts by name or code..."
          placeholderTextColor="#6B7280"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {/* Catalog list (scrollable) */}
      <View style={styles.list}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {visibleRows.map((p, idx) => {
            const selectedQty = selectedQtyById.get(p.id) ?? 0;
            const outOfStock = p.stock <= 0;

            return (
              <View key={p.id} style={[styles.row, idx === 0 ? styles.rowFirst : null]}>
                <View style={styles.rowLeft}>
                  <Text style={styles.partName}>{p.name}</Text>
                  <Text style={styles.partMeta}>
                    {p.code} - Stock: {p.stock}
                    {selectedQty > 0 ? ` • Selected: ${selectedQty}` : ''}
                  </Text>
                </View>

                <Pressable
                  onPress={() => addPart(p)}
                  disabled={outOfStock}
                  style={({ pressed }) => [
                    styles.addBtn,
                    outOfStock && styles.btnDisabled,
                    pressed && !outOfStock && { opacity: 0.7 },
                  ]}
                  hitSlop={10}
                >
                  <Text style={[styles.addText, outOfStock && styles.textDisabled]}>＋</Text>
                </Pressable>
              </View>
            );
          })}

          {visibleRows.length === 0 && (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No parts found.</Text>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Selected parts editor */}
      {value.length > 0 && (
        <View style={styles.selectedWrap}>
          <Text style={styles.selectedTitle}>Selected parts</Text>

          <View style={styles.selectedList}>
            {value.map((v, idx) => (
              <View
                key={v.id}
                style={[styles.selectedRow, idx === 0 ? styles.selectedRowFirst : null]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.selectedName}>
                    {v.name} <Text style={styles.selectedCode}>({v.code})</Text>
                  </Text>
                  <Text style={styles.selectedQty}>Qty: {v.qty}</Text>
                </View>

                <View style={styles.actions}>
                  {/* ➖ decrement */}
                  <Pressable
                    onPress={() => decrementPart(v.id)}
                    style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                    hitSlop={10}
                  >
                    <Text style={styles.actionText}>−</Text>
                  </Pressable>

                  {/* 🗑 remove */}
                  <Pressable
                    onPress={() => removePart(v.id)}
                    style={({ pressed }) => [styles.trashBtn, pressed && { opacity: 0.7 }]}
                    hitSlop={10}
                  >
                    <Text style={styles.trashText}>🗑</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  searchWrap: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  searchInput: {
    fontSize: 16,
    color: '#111827',
  },

  list: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  scroll: {
    maxHeight: 320,
  },
  scrollContent: {
    paddingBottom: 4,
  },

  row: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  rowFirst: { borderTopWidth: 0 },
  rowLeft: { flex: 1 },
  partName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  partMeta: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },

  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginLeft: 10,
  },
  addText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 22,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  textDisabled: {
    color: '#9CA3AF',
  },

  emptyWrap: {
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },

  selectedWrap: {
    marginTop: 14,
  },
  selectedTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 10,
  },
  selectedList: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  selectedRowFirst: { borderTopWidth: 0 },
  selectedName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  selectedCode: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
  },
  selectedQty: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 10,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  actionText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    lineHeight: 22,
  },
  trashBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  trashText: {
    fontSize: 16,
  },
});
