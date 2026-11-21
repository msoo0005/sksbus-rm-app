import { FontAwesome5 } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../api/client";
import { useI18n } from "../i18n/i18n-ctx";
import {
  DEFAULT_JOB_SORT,
  isJobSort,
  JOB_SORT_KEYS,
  JobSort,
  JobSortKey,
  pickJobSort,
  STATUS_GROUPS,
} from "../utils/jobSort";
import { getStoredItem, setStoredItem } from "../utils/storage";

const STORAGE_KEY = "jobsSort";

const CAPTION: Record<JobSortKey, string> = {
  status: "job2.sort.captionStatus",
  criticality: "job2.sort.captionCriticality",
  time: "job2.sort.captionTime",
  bus: "job2.sort.captionBus",
};

/**
 * The jobs list Sort by choice, remembered per user on the device and on the
 * server, so it survives a reinstall (C7).
 */
export function useJobSort(): [JobSort, (next: JobSort) => void] {
  const [sort, setSort] = useState<JobSort>(DEFAULT_JOB_SORT);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const local = await getStoredItem(STORAGE_KEY);
        const parsed = local ? JSON.parse(local) : null;
        if (!cancelled && isJobSort(parsed)) setSort(parsed);
      } catch {
        // ignore a bad stored value
      }
      try {
        const prefs = await api.myPreferences();
        if (!cancelled && isJobSort(prefs?.jobs_sort)) {
          setSort(prefs.jobs_sort);
          setStoredItem(STORAGE_KEY, JSON.stringify(prefs.jobs_sort)).catch(() => {});
        }
      } catch {
        // offline or an older Lambda: keep the local choice
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((next: JobSort) => {
    setSort(next);
    setStoredItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
    api.setMyPreference("jobs_sort", next).catch(() => {});
  }, []);

  return [sort, update];
}

type Props = { value: JobSort; onChange: (next: JobSort) => void };

/** C2 / C7 · "Sort by [Status ↑ ▾]" and its menu. */
export default function SortMenu({ value, onChange }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const arrow = value.dir === "asc" ? "↑" : "↓";

  return (
    <View style={s.bar}>
      <Text style={s.label}>{t("job2.sort.sortBy")}</Text>
      <Pressable style={({ pressed }) => [s.dropdown, pressed && { opacity: 0.75 }]} onPress={() => setOpen(true)}>
        <Text style={s.dropdownText}>
          {t(`job2.sort.${value.key}`)} {arrow}
        </Text>
        <FontAwesome5 name="chevron-down" size={11} color="#374151" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.menu} onPress={(e) => e.stopPropagation()}>
            <Text style={s.menuLabel}>{t("job2.sort.order")}</Text>
            <View style={s.segment}>
              {(["asc", "desc"] as const).map((d) => {
                const on = value.dir === d;
                return (
                  <Pressable
                    key={d}
                    style={[s.segBtn, on && s.segOn]}
                    onPress={() => onChange({ key: value.key, dir: d })}
                  >
                    <Text style={[s.segText, on && s.segTextOn]}>
                      {d === "asc" ? `${t("job2.sort.ascending")} ↑` : `${t("job2.sort.descending")} ↓`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {JOB_SORT_KEYS.map((k) => {
              const on = value.key === k;
              return (
                <Pressable
                  key={k}
                  style={[s.option, on && s.optionOn]}
                  onPress={() => {
                    onChange(pickJobSort(value, k));
                    setOpen(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.optionText, on && { color: "#34873F" }]}>{t(`job2.sort.${k}`)}</Text>
                    <Text style={s.caption}>{t(CAPTION[k])}</Text>
                    {k === "status" && (
                      <View style={s.groups}>
                        {STATUS_GROUPS.map((g) => (
                          <View key={g.group} style={s.groupRow}>
                            <View style={[s.dot, { backgroundColor: g.color }]} />
                            <Text style={s.groupText}>
                              {g.group} {t(`job2.sort.group${g.group}`)}
                              <Text style={s.groupMeaning}> · {t(`job2.sort.group${g.group}Meaning`)}</Text>
                            </Text>
                          </View>
                        ))}
                        <Text style={s.same}>{t("job2.sort.sameStatus")}</Text>
                      </View>
                    )}
                  </View>
                  {on && <FontAwesome5 name="check" size={13} color="#34873F" />}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginBottom: 12,
  },
  label: { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  dropdownText: { fontSize: 13.5, fontWeight: "800", color: "#111827" },
  backdrop: { flex: 1, backgroundColor: "rgba(17,24,39,0.35)", justifyContent: "center", padding: 20 },
  menu: { backgroundColor: "#fff", borderRadius: 18, padding: 14, maxWidth: 440, width: "100%", alignSelf: "center" },
  menuLabel: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.6, marginBottom: 6 },
  segment: { flexDirection: "row", backgroundColor: "#F3F4F6", borderRadius: 12, padding: 3, marginBottom: 10 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  segOn: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 },
  segText: { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  segTextOn: { color: "#111827", fontWeight: "800" },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  optionOn: { backgroundColor: "#F0FDF4" },
  optionText: { fontSize: 15, fontWeight: "800", color: "#111827" },
  caption: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  groups: { marginTop: 8, gap: 4 },
  groupRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  groupText: { fontSize: 12.5, fontWeight: "700", color: "#374151", flexShrink: 1 },
  groupMeaning: { fontWeight: "500", color: "#6B7280" },
  same: { fontSize: 12, color: "#6B7280", fontStyle: "italic", marginTop: 4 },
});
