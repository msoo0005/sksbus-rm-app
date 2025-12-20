// app/(app)/inventory.tsx
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/card';
import SegmentedTabs from '../components/SegmentedTabs';

type TabKey = 'all' | 'low' | 'recent';

type Part = {
  id: string;
  code: string;
  name: string;
  category: string;
  stock: number;
  minStock: number;
  unitPrice: number;
  updatedAt: string; // ISO string
};

const INITIAL_PARTS: Part[] = [
  { id: '1', code: 'BRK-PAD-F', name: 'Front Brake Pads', category: 'Brakes', stock: 24, minStock: 10, unitPrice: 45.99, updatedAt: '2025-10-14T10:00:00Z' },
  { id: '2', code: 'OIL-FLT-STD', name: 'Oil Filter', category: 'Engine', stock: 8, minStock: 15, unitPrice: 12.5, updatedAt: '2025-10-15T11:00:00Z' },
  { id: '3', code: 'AIR-FLT-HD', name: 'Heavy Duty Air Filter', category: 'Engine', stock: 32, minStock: 20, unitPrice: 28.75, updatedAt: '2025-10-15T11:30:00Z' },
  { id: '4', code: 'WPR-BLD-26', name: 'Wiper Blade 26"', category: 'Body', stock: 4, minStock: 10, unitPrice: 19.99, updatedAt: '2025-10-16T08:05:00Z' },
  { id: '5', code: 'FUS-10A', name: 'Fuse 10A (Pack)', category: 'Electrical', stock: 6, minStock: 12, unitPrice: 6.25, updatedAt: '2025-10-17T12:00:00Z' },
  { id: '6', code: 'BLT-ALT-7PK', name: 'Alternator Belt 7PK', category: 'Engine', stock: 14, minStock: 10, unitPrice: 34.5, updatedAt: '2025-10-18T08:40:00Z' },
  { id: '7', code: 'BRK-FLD-DOT4', name: 'Brake Fluid DOT4', category: 'Brakes', stock: 3, minStock: 8, unitPrice: 14.75, updatedAt: '2025-10-18T09:10:00Z' },
  { id: '8', code: 'LMP-H7', name: 'Headlight Bulb H7', category: 'Electrical', stock: 11, minStock: 10, unitPrice: 9.95, updatedAt: '2025-10-18T09:25:00Z' },
  { id: '9', code: 'TYR-VAL-SET', name: 'Tyre Valve Set', category: 'Wheels', stock: 2, minStock: 6, unitPrice: 7.8, updatedAt: '2025-10-18T10:00:00Z' },
  { id: '10', code: 'CLN-DSG-1L', name: 'Degreaser 1L', category: 'Supplies', stock: 9, minStock: 10, unitPrice: 11.25, updatedAt: '2025-10-18T11:45:00Z' },
];

const money = (n: number) => `$${n.toFixed(2)}`;
const isLowStock = (p: Part) => p.stock < p.minStock;

type ColKey =
  | 'code'
  | 'name'
  | 'category'
  | 'stock'
  | 'min'
  | 'unit'
  | 'status'
  | 'actions';

type ColSpec = {
  key: ColKey;
  min: number;     // minimum width on very small screens
  max: number;     // cap growth on large screens (so name doesn't eat everything)
  weight: number;  // how extra space is distributed
  align?: 'left' | 'center' | 'right';
};

const COLS: ColSpec[] = [
  { key: 'code', min: 110, max: 160, weight: 0.8 },
  { key: 'name', min: 180, max: 320, weight: 2.4 },
  { key: 'category', min: 110, max: 180, weight: 1.1 },
  { key: 'stock', min: 70, max: 90, weight: 0.4, align: 'center' },
  { key: 'min', min: 70, max: 90, weight: 0.4, align: 'right' },
  { key: 'unit', min: 90, max: 120, weight: 0.6, align: 'right' },
  { key: 'status', min: 120, max: 170, weight: 0.7, align: 'right' },
  { key: 'actions', min: 190, max: 260, weight: 1.2, align: 'right' },
];

function computeColumnWidths(available: number) {
  const minTotal = COLS.reduce((s, c) => s + c.min, 0);

  // If the screen is narrow, stick to mins and allow horizontal scroll.
  if (available <= minTotal) {
    const widths: Record<ColKey, number> = {} as any;
    for (const c of COLS) widths[c.key] = c.min;
    return { widths, tableWidth: minTotal };
  }

  // Otherwise distribute extra space by weight, capped by max.
  const widths: Record<ColKey, number> = {} as any;
  for (const c of COLS) widths[c.key] = c.min;

  let remaining = available - minTotal;

  // Distribute in a few passes so max caps are respected.
  for (let pass = 0; pass < 6 && remaining > 0.5; pass++) {
    const growable = COLS.filter((c) => widths[c.key] < c.max);
    if (growable.length === 0) break;

    const weightSum = growable.reduce((s, c) => s + c.weight, 0) || 1;

    let consumedThisPass = 0;

    for (const c of growable) {
      const share = (remaining * c.weight) / weightSum;
      const room = c.max - widths[c.key];
      const add = Math.min(room, share);
      widths[c.key] += add;
      consumedThisPass += add;
    }

    remaining -= consumedThisPass;

    // If we couldn't consume much (all capped), stop.
    if (consumedThisPass < 0.5) break;
  }

  const tableWidth = COLS.reduce((s, c) => s + widths[c.key], 0);
  return { widths, tableWidth };
}

export default function Inventory() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();

  const [tab, setTab] = useState<TabKey>('all');
  const [query, setQuery] = useState('');
  const [parts, setParts] = useState<Part[]>(INITIAL_PARTS);

  const totalParts = parts.length;
  const lowStockCount = parts.filter(isLowStock).length;
  const totalValue = parts.reduce((sum, p) => sum + p.stock * p.unitPrice, 0);

  const filteredParts = useMemo(() => {
    const q = query.trim().toLowerCase();

    let base = parts;
    if (tab === 'low') base = base.filter(isLowStock);
    if (tab === 'recent') base = [...base].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    if (!q) return base;

    return base.filter((p) => {
      return (
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [parts, tab, query]);

  const tabCounts = useMemo(() => {
    return {
      all: parts.length,
      low: parts.filter(isLowStock).length,
      recent: parts.length,
    };
  }, [parts]);

  const onAdd = (id: string) => {
    setParts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, stock: p.stock + 1, updatedAt: new Date().toISOString() } : p
      )
    );
  };

  const onRemove = (id: string) => {
    setParts((prev) => prev.filter((p) => p.id !== id));
  };

  // Compute dynamic column widths based on screen width.
  const tableLayout = useMemo(() => {
    const outerPadding = 18 * 2; // matches your row/header horizontal padding
    const safeAvailable = Math.max(0, windowWidth - outerPadding);
    return computeColumnWidths(safeAvailable);
  }, [windowWidth]);

  const W = tableLayout.widths;

  const cell = (key: ColKey) => ({ width: W[key] });
  const textAlignFor = (key: ColKey) => {
    const spec = COLS.find((c) => c.key === key);
    if (spec?.align === 'center') return styles.centerText;
    if (spec?.align === 'right') return styles.rightText;
    return null;
  };

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={[]}
        keyExtractor={() => 'x'}
        renderItem={null as any}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            {/* Back */}
            <View style={styles.topBar}>
              <Pressable onPress={() => router.back()} style={styles.backBtn}>
                <Text style={styles.backArrow}>←</Text>
                <Text style={styles.backText}>Back to Roles</Text>
              </Pressable>
            </View>

            {/* Title */}
            <View style={styles.header}>
              <Text style={styles.title}>Inventory Manager</Text>
              <Text style={styles.subtitle}>Manage parts and supplies</Text>
            </View>

            {/* Stats cards */}
            <View style={styles.statsRow}>
              <StatCard title="Total Parts" value={`${totalParts}`} subtitle="Active SKUs" />
              <StatCard title="Low Stock Alerts" value={`${lowStockCount}`} subtitle="Items need restocking" danger />
              <StatCard title="Total Value" value={money(totalValue)} subtitle="Current inventory value" />
            </View>

            {/* Tabs */}
            <View style={styles.tabsWrap}>
              <SegmentedTabs<TabKey>
                value={tab}
                onChange={setTab}
                tabs={[
                  { key: 'all', label: `All Parts (${tabCounts.all})` },
                  { key: 'low', label: `Low Stock (${tabCounts.low})` },
                  { key: 'recent', label: 'Recent Activity' },
                ]}
              />
            </View>

            {/* Search */}
            <View style={styles.searchWrap}>
              <View style={styles.searchBox}>
                <Text style={styles.searchIcon}>🔎</Text>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search parts by name, code, or category..."
                  placeholderTextColor="#8A8FA3"
                  style={styles.searchInput}
                />
              </View>
            </View>

            {/* TABLE (header + rows share one horizontal scroll) */}
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={[styles.table, { width: tableLayout.tableWidth }]}>
                {/* Header */}
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, cell('code')]}>Code</Text>
                  <Text style={[styles.th, cell('name')]}>Name</Text>
                  <Text style={[styles.th, cell('category')]}>Category</Text>
                  <Text style={[styles.th, cell('stock'), styles.centerText]}>Stock</Text>
                  <Text style={[styles.th, cell('min'), styles.centerText]}>Min.</Text>
                  <Text style={[styles.th, cell('unit'), styles.rightText]}>Unit</Text>
                  <Text style={[styles.th, cell('status')]}>Status</Text>
                  <Text style={[styles.th, cell('actions')]}>Actions</Text>
                </View>

                {/* Rows (vertical scroll handled by outer screen, so this list is not scrollable) */}
                <FlatList
                  data={filteredParts}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                  ItemSeparatorComponent={() => <View style={styles.sepInner} />}
                  ListEmptyComponent={
                    <View style={styles.empty}>
                      <Text style={styles.emptyTitle}>No items found</Text>
                      <Text style={styles.emptySub}>Try clearing your search or changing tabs.</Text>
                    </View>
                  }
                  renderItem={({ item }) => {
                    const low = isLowStock(item);

                    return (
                      <View style={styles.row}>
                        <Text style={[styles.td, cell('code')]} numberOfLines={1}>
                          {item.code}
                        </Text>

                        <Text style={[styles.td, cell('name')]} numberOfLines={1}>
                          {item.name}
                        </Text>

                        <Text style={[styles.td, cell('category')]} numberOfLines={1}>
                          {item.category}
                        </Text>

                        <Text style={[styles.td, cell('stock'), styles.centerText]}>
                          {item.stock}
                        </Text>

                        <Text style={[styles.td, cell('min'), styles.centerText]}>
                          {item.minStock}
                        </Text>

                        <Text style={[styles.td, cell('unit'), styles.rightText]}>
                          {money(item.unitPrice)}
                        </Text>

                        <Text
                          style={[
                            styles.td,
                            cell('status'),
                            low ? styles.statusLow : styles.statusOk,
                          ]}
                          numberOfLines={1}
                        >
                          {low ? 'Low Stock' : 'In Stock'}
                        </Text>

                        <View style={[cell('actions'), styles.actionsCell]}>
                          <Pressable onPress={() => onAdd(item.id)} style={styles.actionBtn}>
                            <Text style={styles.actionBtnText}>＋ Add</Text>
                          </Pressable>

                          <Pressable onPress={() => onRemove(item.id)} style={styles.actionBtn}>
                            <Text style={styles.actionBtnText}>Remove</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  }}
                />
              </View>
            </ScrollView>
          </>
        }
      />
    </SafeAreaView>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  danger,
}: {
  title: string;
  value: string;
  subtitle: string;
  danger?: boolean;
}) {
  return (
    <Card style={styles.statCard}>
      <CardHeader style={styles.statHeader}>
        <View style={styles.statHeaderRow}>
          <CardTitle style={styles.statTitle}>{title}</CardTitle>
          <Text style={[styles.statTrend, danger && styles.statTrendDanger]}>{danger ? '↘' : '↗'}</Text>
        </View>
        <Text style={styles.statValue}>{value}</Text>
        <CardDescription style={styles.statSub}>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingBottom: 28 },

  topBar: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backArrow: { fontSize: 18, color: '#111827' },
  backText: { fontSize: 14, color: '#111827', fontWeight: '700' },

  header: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14 },
  title: { fontSize: 34, fontWeight: '800', color: '#111827' },
  subtitle: { marginTop: 6, fontSize: 16, color: '#6B7280' },

  statsRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 18, paddingBottom: 10 },
  statCard: { flex: 1, borderRadius: 16, paddingVertical: 0 },
  statHeader: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 },
  statHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statTitle: { fontSize: 14, fontWeight: '700' },
  statTrend: { fontSize: 14, color: '#6B7280' },
  statTrendDanger: { color: '#E11D48' },
  statValue: { marginTop: 12, fontSize: 28, fontWeight: '800', color: '#111827' },
  statSub: { marginTop: 6, fontSize: 12, color: '#6B7280' },

  tabsWrap: { paddingHorizontal: 18, paddingVertical: 8 },

  searchWrap: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
  },
  searchIcon: { marginRight: 8, fontSize: 14 },
  searchInput: { flex: 1, fontSize: 14, color: '#111827' },

  // Table container (width is set dynamically)
  table: {
    backgroundColor: '#FFFFFF',
  },

  tableHeader: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },

  th: { fontSize: 12, color: '#111827', fontWeight: '800' },

  row: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },

  td: { fontSize: 12, color: '#111827', fontWeight: '600' },

  sepInner: { height: 1, backgroundColor: '#E5E7EB', marginHorizontal: 18 },

  centerText: { textAlign: 'left' },
  rightText: { textAlign: 'left' },

  statusOk: { color: '#111827' },
  statusLow: { color: '#B45309' },

  actionsCell: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },

  actionBtn: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  actionBtnText: { fontSize: 12, fontWeight: '800', color: '#111827' },

  empty: { paddingHorizontal: 18, paddingVertical: 30 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  emptySub: { marginTop: 6, fontSize: 13, color: '#6B7280' },
});
