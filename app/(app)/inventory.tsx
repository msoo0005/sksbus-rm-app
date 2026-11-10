// app/(app)/inventory.tsx
// Parts Admin: the catalogue technicians pick from when adding parts to a
// job. Only roles that can edit parts reach this screen (admin, rm_manager,
// inventory_manager — see ROLE_ALLOWED_PREFIXES in _layout.tsx).
//
// Each part's quantity on hand (PART.part_stock) is shown and edited here.
// It isn't yet deducted automatically when a technician uses a part on a job
// — that's a later piece of work — so it's kept up to date by hand for now.
import { FontAwesome5 } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api, CatalogPart, PartInput } from '@/api/client';
import { useI18n } from '@/i18n/i18n-ctx';

const formatPrice = (v: CatalogPart['part_cost']) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? `RM ${n.toFixed(2)}` : null;
};

type FormState = { name: string; code: string; brand: string; price: string; stock: string };
const EMPTY_FORM: FormState = { name: '', code: '', brand: '', price: '', stock: '' };

const stockOf = (p: CatalogPart) => {
  const n = Number(p.part_stock);
  return Number.isFinite(n) ? n : 0;
};

export default function Inventory() {
  const { t } = useI18n();

  const [parts, setParts] = useState<CatalogPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  // null = closed; 'new' = adding; a part = editing that part.
  const [editing, setEditing] = useState<CatalogPart | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const rows = await api.parts();
        setParts(Array.isArray(rows) ? rows : []);
      } catch (e: any) {
        Alert.alert(t('inventory.loadFailed'), e?.message ?? t('common.unknownError'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    load();
  }, [load]);

  const totalItems = useMemo(() => parts.reduce((sum, p) => sum + stockOf(p), 0), [parts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter((p) =>
      [p.part_name, p.part_code, p.part_brand ?? ''].some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [parts, query]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditing('new');
  };

  const openEdit = (p: CatalogPart) => {
    setForm({
      name: p.part_name ?? '',
      code: p.part_code ?? '',
      brand: p.part_brand ?? '',
      price: p.part_cost == null ? '' : String(Number(p.part_cost)),
      stock: String(stockOf(p)),
    });
    setEditing(p);
  };

  const closeForm = () => {
    if (saving) return;
    setEditing(null);
  };

  const save = async () => {
    if (saving || !editing) return;

    const name = form.name.trim();
    const code = form.code.trim();
    const brand = form.brand.trim();
    const priceRaw = form.price.trim().replace(/^RM\s*/i, '').replace(/,/g, '');

    if (!name) return Alert.alert(t('inventory.saveFailed'), t('inventory.nameRequired'));
    if (!code) return Alert.alert(t('inventory.saveFailed'), t('inventory.numberRequired'));

    let price: number | null = null;
    if (priceRaw) {
      price = Number(priceRaw);
      if (!Number.isFinite(price) || price < 0) {
        return Alert.alert(t('inventory.saveFailed'), t('inventory.invalidPrice'));
      }
    }

    const stockRaw = form.stock.trim();
    const stock = stockRaw ? Number(stockRaw) : 0;
    if (!/^\d*$/.test(stockRaw) || !Number.isInteger(stock) || stock < 0) {
      return Alert.alert(t('inventory.saveFailed'), t('inventory.invalidStock'));
    }

    const body: PartInput = {
      part_name: name,
      part_code: code,
      part_brand: brand || null,
      part_cost: price,
      part_stock: stock,
    };

    setSaving(true);
    try {
      if (editing === 'new') await api.createPart(body);
      else await api.updatePart(editing.part_id, body);
    } catch (e: any) {
      Alert.alert(t('inventory.saveFailed'), e?.message ?? t('common.unknownError'));
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditing(null);
    load(true);
  };

  const renderPart = ({ item }: { item: CatalogPart }) => {
    const price = formatPrice(item.part_cost);
    const stock = stockOf(item);
    return (
      <Pressable style={({ pressed }) => [s.partCard, pressed && s.pressed]} onPress={() => openEdit(item)}>
        <View style={s.partIcon}>
          <FontAwesome5 name="cog" size={16} color="#16A34A" />
        </View>
        <View style={s.partBody}>
          <Text style={s.partName} numberOfLines={2}>{item.part_name}</Text>
          <Text style={s.partMeta} numberOfLines={1}>
            {item.part_code} · {item.part_brand || t('inventory.noBrand')}
          </Text>
          <View style={[s.stockPill, stock === 0 && s.stockPillEmpty]}>
            <Text style={[s.stockText, stock === 0 && s.stockTextEmpty]}>
              {stock === 0 ? t('inventory.outOfStock') : t('inventory.inStock', { count: stock })}
            </Text>
          </View>
        </View>
        <View style={s.partRight}>
          <Text style={[s.partPrice, !price && s.partPriceMissing]}>{price ?? t('inventory.noPrice')}</Text>
          <FontAwesome5 name="pen" size={11} color="#9CA3AF" />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={s.page}>
      <FlatList
        data={filtered}
        keyExtractor={(p) => String(p.part_id)}
        renderItem={renderPart}
        contentContainerStyle={s.content}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={s.header}>
            <Text style={s.subtitle}>{t('inventory.subtitle')}</Text>

            <View style={s.headerRow}>
              <View style={s.stats}>
                <View>
                  <Text style={s.count}>{parts.length}</Text>
                  <Text style={s.countLabel}>{t('inventory.totalParts')}</Text>
                </View>
                <View>
                  <Text style={s.count}>{totalItems.toLocaleString()}</Text>
                  <Text style={s.countLabel}>{t('inventory.totalItems')}</Text>
                </View>
              </View>
              <Pressable style={({ pressed }) => [s.addBtn, pressed && s.pressed]} onPress={openAdd}>
                <FontAwesome5 name="plus" size={13} color="#fff" />
                <Text style={s.addBtnText}>{t('inventory.addPart')}</Text>
              </Pressable>
            </View>

            <View style={s.searchBox}>
              <FontAwesome5 name="search" size={13} color="#9CA3AF" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('inventory.searchPlaceholder')}
                placeholderTextColor="#9CA3AF"
                style={s.searchInput}
                autoCorrect={false}
              />
            </View>

          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 30 }} />
          ) : (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>
                {parts.length ? t('inventory.noMatches') : t('inventory.noItemsFound')}
              </Text>
              {!parts.length && <Text style={s.emptySub}>{t('inventory.noItemsFoundHint')}</Text>}
            </View>
          )
        }
      />

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={closeForm}>
        <KeyboardAvoidingView
          style={s.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              {editing === 'new' ? t('inventory.addPart') : t('inventory.editPart')}
            </Text>

            <Field
              label={t('inventory.partName')}
              value={form.name}
              placeholder={t('inventory.partNamePlaceholder')}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              editable={!saving}
              required
            />
            <Field
              label={t('inventory.partNumber')}
              value={form.code}
              placeholder={t('inventory.partNumberPlaceholder')}
              onChange={(v) => setForm((f) => ({ ...f, code: v }))}
              editable={!saving}
              autoCapitalize="characters"
              required
            />
            <Field
              label={t('inventory.partBrand')}
              value={form.brand}
              placeholder={t('inventory.partBrandPlaceholder')}
              onChange={(v) => setForm((f) => ({ ...f, brand: v }))}
              editable={!saving}
            />
            <Field
              label={t('inventory.partPrice')}
              value={form.price}
              placeholder={t('inventory.partPricePlaceholder')}
              onChange={(v) => setForm((f) => ({ ...f, price: v }))}
              editable={!saving}
              keyboardType="decimal-pad"
            />
            <Field
              label={t('inventory.partStock')}
              value={form.stock}
              placeholder="0"
              onChange={(v) => setForm((f) => ({ ...f, stock: v }))}
              editable={!saving}
              keyboardType="number-pad"
            />

            <View style={s.modalButtons}>
              <Pressable style={s.cancelBtn} onPress={closeForm} disabled={saving}>
                <Text style={s.cancelText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                <Text style={s.saveText}>{saving ? t('inventory.saving') : t('inventory.save')}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
  editable,
  required,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  editable: boolean;
  required?: boolean;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>
        {label}
        {required && <Text style={{ color: '#DC2626' }}> *</Text>}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        style={s.input}
        editable={editable}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  pressed: { opacity: 0.7 },

  header: { marginBottom: 14, gap: 12 },
  subtitle: { fontSize: 14, color: '#6B7280', fontWeight: '500' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontSize: 28, fontWeight: '800', color: '#111827' },
  countLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#16A34A',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 4,
    backgroundColor: '#fff',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#111827' },

  partCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
  },
  partIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  partBody: { flex: 1 },
  partName: { fontSize: 15, fontWeight: '800', color: '#111827' },
  partMeta: { marginTop: 2, fontSize: 12, fontWeight: '600', color: '#6B7280' },
  partRight: { alignItems: 'flex-end', gap: 6 },
  partPrice: { fontSize: 14, fontWeight: '800', color: '#111827' },
  partPriceMissing: { color: '#9CA3AF', fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 24 },
  stockPill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#F0FDF4',
  },
  stockPillEmpty: { backgroundColor: '#FEF2F2' },
  stockText: { fontSize: 12, fontWeight: '800', color: '#15803D' },
  stockTextEmpty: { color: '#DC2626' },

  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  emptySub: { marginTop: 6, fontSize: 13, color: '#6B7280' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 20, padding: 22 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 14 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '700', color: '#374151' },
  saveBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#16A34A', alignItems: 'center' },
  saveText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
