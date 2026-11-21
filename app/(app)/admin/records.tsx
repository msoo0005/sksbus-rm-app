// Admin "Reports & jobs": every report and job, searchable, to open and
// correct or delete. Only admins reach this screen (see _layout.tsx).

import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { api, type AdminRecord, type AdminRecordFilter } from "@/api/client";
import FilterChipRow from "@/components/FilterChipRow";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useI18n } from "@/i18n/i18n-ctx";
import { ADMIN_STATUS_COLORS } from "@/utils/adminRecords";
import { formatBusLabel } from "@/utils/busLabel";
import { formatDateTime } from "@/utils/datetime";
import { reportTypeTitleLabel } from "@/utils/reportType";
import { KEYBOARD_DISMISS_MODE } from "@/utils/keyboard";

const FILTERS: AdminRecordFilter[] = ["all", "pending", "active", "awaiting", "closed", "declined", "draft"];

export default function AdminRecordsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const projectId = useProjectFilter();
  const [filter, setFilter] = useState<AdminRecordFilter>("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<AdminRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the newest request may set the list, so a slow earlier search can't
  // overwrite a later one.
  const requestNo = useRef(0);

  // Search after a short pause in typing.
  useEffect(() => {
    const h = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(h);
  }, [query]);

  const load = useCallback(
    async (mode: "first" | "refresh" | "more") => {
      const n = ++requestNo.current;
      if (mode === "first") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      if (mode === "more") setLoadingMore(true);
      try {
        const res = await api.adminRecords({
          q: search || undefined,
          status: filter,
          project_id: projectId,
          offset: mode === "more" ? nextOffset : 0,
        });
        if (n !== requestNo.current) return;
        setItems((prev) => (mode === "more" ? [...prev, ...res.items] : res.items));
        setHasMore(res.has_more);
        setNextOffset(res.next_offset);
        setError(null);
      } catch (e: any) {
        if (n === requestNo.current) setError(e?.message ?? t("common.failedToLoad"));
      } finally {
        if (n === requestNo.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [search, filter, projectId, nextOffset, t],
  );

  // Reload on focus (coming back from an edit or delete) and when the
  // search or filter changes.
  const loadRef = useRef(load);
  loadRef.current = load;
  useFocusEffect(
    useCallback(() => {
      loadRef.current("first");
      // The list depends on these; loadRef always holds the latest load().
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, filter, projectId]),
  );

  return (
    <View style={s.page}>
      <View style={s.searchWrap}>
        <FontAwesome5 name="search" size={13} color="#9CA3AF" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("adminRecords.search")}
          placeholderTextColor="#9CA3AF"
          style={s.searchInput}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>
      <View style={{ paddingVertical: 8 }}>
        <FilterChipRow
          items={FILTERS.map((k) => ({ key: k, label: t(`adminRecords.filters.${k}`) }))}
          value={filter}
          onChange={setFilter}
        />
      </View>

      {loading && !items.length ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <FlatList keyboardDismissMode={KEYBOARD_DISMISS_MODE}
          data={items}
          keyExtractor={(r) => String(r.report_id)}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} />}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={s.empty}>{error ?? t("adminRecords.empty")}</Text>}
          ListFooterComponent={
            hasMore ? (
              <Pressable style={s.more} onPress={() => load("more")} disabled={loadingMore}>
                {loadingMore ? <ActivityIndicator /> : <Text style={s.moreText}>{t("adminRecords.loadMore")}</Text>}
              </Pressable>
            ) : null
          }
          renderItem={({ item: r }) => {
            const c = ADMIN_STATUS_COLORS[r.status] ?? ADMIN_STATUS_COLORS.draft;
            return (
              <Pressable
                style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
                onPress={() => router.push(`/admin/record/${r.report_id}` as any)}
              >
                <View style={s.rowTop}>
                  <Text style={s.ref} numberOfLines={1}>
                    {r.ref_no ?? `#${r.report_id}`}
                  </Text>
                  <View style={[s.pill, { backgroundColor: c.bg }]}>
                    <Text style={[s.pillText, { color: c.fg }]}>{t(`adminRecords.status.${r.status}`)}</Text>
                  </View>
                </View>
                <Text style={s.title} numberOfLines={1}>
                  {formatBusLabel(r.bus_id, r.bus_ev_no)} · {reportTypeTitleLabel(r.type, t)}
                </Text>
                {!!r.desc && (
                  <Text style={s.desc} numberOfLines={2}>
                    {r.desc}
                  </Text>
                )}
                <Text style={s.meta} numberOfLines={1}>
                  {[
                    r.submitted_at ? formatDateTime(r.submitted_at) : null,
                    r.reporter_name,
                    r.job_id != null ? r.technician_name ?? t("adminRecords.noTechnician") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  searchInput: { flex: 1, fontSize: 15, color: "#111827" },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 10, width: "100%", maxWidth: 720, alignSelf: "center" },
  row: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#F3F4F6", padding: 14 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  ref: { flex: 1, fontSize: 12.5, fontWeight: "800", color: "#6B7280" },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11.5, fontWeight: "800" },
  title: { fontSize: 15.5, fontWeight: "800", color: "#111827", marginTop: 6 },
  desc: { fontSize: 13, color: "#4B5563", marginTop: 3, lineHeight: 18 },
  meta: { fontSize: 12, color: "#9CA3AF", marginTop: 6 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  more: { height: 46, alignItems: "center", justifyContent: "center" },
  moreText: { fontSize: 14, fontWeight: "800", color: "#1F2937" },
});
