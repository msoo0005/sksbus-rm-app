// PUSPAKOM schedule (Fleet Manager screen 2; R&M Manager screen 2, view only).
// One card per bus; each bus has exactly one status at a time.

import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PspBusState, PspSchedule, PspStatus, puspakomApi } from "@/api/puspakom";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import Sheet from "@/components/Sheet";
import StatusPill from "@/components/puspakom/StatusPill";
import { useSession } from "@/ctx";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useI18n } from "@/i18n/i18n-ctx";
import {
  STATUS_TONE,
  STATUS_URGENCY,
  addDays,
  fmtDate,
  fmtDayMonth,
  fmtShortDateTime,
  monthKey,
  monthLabel,
} from "@/utils/puspakom";
import { ROLE_COLORS } from "@/utils/roles";

type SortKey = "earliest" | "latest" | "urgent" | "inspection" | "busNo" | "fleetNo";
const SORTS: SortKey[] = ["earliest", "latest", "urgent", "inspection", "busNo", "fleetNo"];
const ALL_STATUSES: PspStatus[] = [
  "OVERDUE_NOT_BOOKED",
  "OVERDUE_BOOKED",
  "FAILED_PENDING",
  "INSPECTED_UPDATE",
  "NOT_BOOKED",
  "BOOKED",
  "PRECHECK_DONE",
  "NOT_DUE",
];

// "The choice is kept until the app is closed" (spec 2b): module scope, not storage.
let keptSort: SortKey = "earliest";

const fleetNum = (b: PspBusState) => Number(String(b.bus_ev_no ?? "").replace(/\D/g, "")) || Number.MAX_SAFE_INTEGER;

function sortBuses(list: PspBusState[], key: SortKey): PspBusState[] {
  const due = (b: PspBusState) => b.next_due ?? "9999-12-31";
  const byDue = (a: PspBusState, b: PspBusState) => due(a).localeCompare(due(b)) || a.bus_id.localeCompare(b.bus_id);
  const out = [...list];
  switch (key) {
    case "earliest":
      return out.sort(byDue);
    case "latest":
      return out.sort((a, b) => {
        // No due date (never passed) still goes last.
        if (!a.next_due !== !b.next_due) return a.next_due ? -1 : 1;
        return due(b).localeCompare(due(a)) || a.bus_id.localeCompare(b.bus_id);
      });
    case "urgent":
      return out.sort((a, b) => STATUS_URGENCY.indexOf(a.status) - STATUS_URGENCY.indexOf(b.status) || byDue(a, b));
    case "inspection":
      return out.sort((a, b) => {
        const x = a.open?.scheduled_at ?? "9999";
        const y = b.open?.scheduled_at ?? "9999";
        return x.localeCompare(y) || byDue(a, b);
      });
    case "busNo":
      return out.sort((a, b) => a.bus_id.localeCompare(b.bus_id));
    case "fleetNo":
      return out.sort((a, b) => fleetNum(a) - fleetNum(b) || a.bus_id.localeCompare(b.bus_id));
  }
}

export default function PuspakomScheduleScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const projectId = useProjectFilter();
  const { dbUser } = useSession() as any;
  const role = String(dbUser?.user_role ?? "");
  const accent = role === "rm_manager" ? ROLE_COLORS.rm_manager.accent : ROLE_COLORS.fleet_manager.accent;

  const [data, setData] = useState<PspSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Every bus in one list by default. The spec defaults to the current month,
  // but buses only get a due date once they have passed in the app; until the
  // fleet has a pass on record, a month view would hide most of it.
  const [month, setMonth] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [statuses, setStatuses] = useState<PspStatus[]>([]);
  const [draftStatuses, setDraftStatuses] = useState<PspStatus[]>([]);
  const [sort, setSortState] = useState<SortKey>(keptSort);
  const [statusOpen, setStatusOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const setSort = (k: SortKey) => {
    keptSort = k;
    setSortState(k);
  };

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await puspakomApi.schedule(projectId));
    } catch (e: any) {
      setError(e?.message ?? t("puspakom.loadError"));
    }
  }, [projectId, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const buses = useMemo(() => data?.buses ?? [], [data]);
  const thisMonth = data ? monthKey(data.today) : null;

  const months = useMemo(() => {
    if (!thisMonth) return [];
    const [y, m] = thisMonth.split("-").map(Number);
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1 + i, 1));
      const key = d.toISOString().slice(0, 7);
      return { key, count: buses.filter((b) => b.next_due && monthKey(b.next_due) === key).length };
    });
  }, [buses, thisMonth]);

  const inMonth = useMemo(
    () => (month === "ALL" ? buses : buses.filter((b) => b.next_due && monthKey(b.next_due) === month)),
    [buses, month],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = inMonth.filter(
      (b) =>
        (!statuses.length || statuses.includes(b.status)) &&
        (!needle || b.bus_id.toLowerCase().includes(needle) || String(b.bus_ev_no ?? "").toLowerCase().includes(needle)),
    );
    return sortBuses(list, sort);
  }, [inMonth, q, statuses, sort]);

  // Under "All", group the list under month headings (no due date last).
  const groups = useMemo(() => {
    if (month !== "ALL") return [{ key: month, items: shown }];
    const map = new Map<string, PspBusState[]>();
    for (const b of shown) {
      const k = b.next_due ? monthKey(b.next_due) : "NONE";
      map.set(k, [...(map.get(k) ?? []), b]);
    }
    return [...map.entries()].map(([key, items]) => ({ key, items }));
  }, [shown, month]);

  const canEdit = !!data?.can_edit;
  const counts = data?.counts;

  const applyCount = (list: PspStatus[]) => {
    setMonth("ALL");
    setStatuses(list);
  };

  const statusLabel =
    statuses.length === 0
      ? t("puspakom.statusAll")
      : statuses.length === 1
        ? t(`puspakom.status.${statuses[0]}`)
        : t("puspakom.nSelected", { count: statuses.length });

  return (
    <View style={s.page}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.headRow}>
          <PuspakomMark />
          <Pressable style={[s.reportsBtn, { borderColor: `${accent}55` }]} onPress={() => router.push("/puspakom/reports" as any)}>
            <FontAwesome5 name="file-alt" size={12} color={accent} />
            <Text style={[s.reportsBtnText, { color: accent }]}>{t("puspakom.reportsKpis")}</Text>
          </Pressable>
        </View>
        <Text style={s.h1}>{t("puspakom.inspections")}</Text>
        <Text style={s.sub}>{canEdit ? t("puspakom.subtitle") : t("puspakom.viewOnly")}</Text>

        {!!error && (
          <View style={s.error}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {counts && (
          <View style={s.countRow}>
            <CountTile
              n={counts.overdue}
              label={t("puspakom.counts.overdue")}
              tone={STATUS_TONE.OVERDUE_NOT_BOOKED}
              onPress={() => applyCount(["OVERDUE_NOT_BOOKED", "OVERDUE_BOOKED"])}
            />
            <CountTile
              n={counts.need_booking}
              label={t("puspakom.counts.needBooking")}
              tone={STATUS_TONE.NOT_BOOKED}
              onPress={() => applyCount(["NOT_BOOKED"])}
            />
            <CountTile
              n={counts.booked}
              label={t("puspakom.counts.booked")}
              tone={STATUS_TONE.BOOKED}
              onPress={() =>
                applyCount(["BOOKED", "OVERDUE_BOOKED", "PRECHECK_DONE", "INSPECTED_UPDATE", "FAILED_PENDING"])
              }
            />
          </View>
        )}

        {canEdit && (
          <Pressable
            style={({ pressed }) => [s.primary, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/puspakom/register" as any)}
          >
            <FontAwesome5 name="plus" size={13} color="#fff" />
            <Text style={s.primaryText}>{t("puspakom.register")}</Text>
          </Pressable>
        )}

        <View style={s.monthCard}>
          <View style={s.monthHead}>
            <Text style={s.monthTitle}>{t("puspakom.dueByMonth")}</Text>
            <Text style={s.monthHint}>{t("puspakom.swipeMore")}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <MonthChip label={t("puspakom.all").toUpperCase()} n={buses.length} active={month === "ALL"} accent={accent} onPress={() => setMonth("ALL")} />
            {months.map((m) => (
              <MonthChip
                key={m.key}
                label={monthLabel(m.key, false)}
                n={m.count}
                active={month === m.key}
                accent={accent}
                onPress={() => setMonth(m.key)}
              />
            ))}
          </ScrollView>
          <View style={s.searchBox}>
            <FontAwesome5 name="search" size={13} color="#9CA3AF" />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={t("puspakom.search")}
              placeholderTextColor="#9CA3AF"
              style={s.searchInput}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
          <View style={s.filterRow}>
            <Pressable
              style={s.filterBtn}
              onPress={() => {
                setDraftStatuses(statuses);
                setStatusOpen(true);
              }}
            >
              <Text style={s.filterLabel}>{t("puspakom.statusButton")}</Text>
              <Text style={s.filterValue} numberOfLines={1}>
                {statusLabel}
              </Text>
              <FontAwesome5 name="chevron-down" size={10} color="#6B7280" />
            </Pressable>
            <Pressable style={s.filterBtn} onPress={() => setSortOpen(true)}>
              <FontAwesome5 name="sort-amount-down" size={11} color="#374151" />
              <Text style={s.filterValue} numberOfLines={1}>
                {t(`puspakom.sort.${sort}`)}
              </Text>
              <FontAwesome5 name="chevron-down" size={10} color="#6B7280" />
            </Pressable>
          </View>
        </View>

        {groups.map((g) => (
          <View key={g.key}>
            <View style={s.listHead}>
              <Text style={s.listHeadTitle}>
                {g.key === "NONE" ? t("puspakom.noPassYet") : g.key === "ALL" ? t("puspakom.allMonths") : monthLabel(g.key)}
              </Text>
              <Text style={s.listHeadMeta}>
                {t("puspakom.listCount", { count: g.items.length, sort: t(`puspakom.sort.${sort}`).toLowerCase() })}
              </Text>
            </View>
            {g.items.map((b) => (
              <BusCard key={b.bus_id} bus={b} onPress={() => router.push(`/puspakom/bus/${encodeURIComponent(b.bus_id)}` as any)} />
            ))}
          </View>
        ))}
        {data && shown.length === 0 && <Text style={s.empty}>{t("puspakom.empty")}</Text>}

        <Text style={s.footer}>
          {t("puspakom.footer")}{" "}
          <Text style={{ color: accent, textDecorationLine: "underline" }} onPress={() => router.push("/puspakom/reports" as any)}>
            {t("puspakom.reportsLink")}
          </Text>
          .
        </Text>
      </ScrollView>

      <Sheet
        visible={statusOpen}
        title={t("puspakom.statusSheet.title")}
        subtitle={t("puspakom.statusSheet.subtitle", {
          month: month === "ALL" ? t("puspakom.allMonths") : monthLabel(month),
        })}
        onClose={() => setStatusOpen(false)}
        footer={
          <>
            <Pressable style={s.sheetSecondary} onPress={() => setDraftStatuses([])}>
              <Text style={s.sheetSecondaryText}>{t("puspakom.statusSheet.reset")}</Text>
            </Pressable>
            <Pressable
              style={[s.sheetPrimary, { backgroundColor: accent }]}
              onPress={() => {
                setStatuses(draftStatuses);
                setStatusOpen(false);
              }}
            >
              <Text style={s.sheetPrimaryText}>
                {t("puspakom.statusSheet.show", {
                  count: inMonth.filter((b) => !draftStatuses.length || draftStatuses.includes(b.status)).length,
                })}
              </Text>
            </Pressable>
          </>
        }
      >
        <OptionRow
          label={t("puspakom.statusSheet.allStatuses")}
          count={inMonth.length}
          selected={draftStatuses.length === 0}
          round
          accent={accent}
          onPress={() => setDraftStatuses([])}
        />
        {ALL_STATUSES.map((st) => {
          const n = inMonth.filter((b) => b.status === st).length;
          const on = draftStatuses.includes(st);
          return (
            <OptionRow
              key={st}
              pill={<StatusPill status={st} />}
              count={n}
              selected={on}
              dim={n === 0}
              accent={accent}
              onPress={() => setDraftStatuses(on ? draftStatuses.filter((x) => x !== st) : [...draftStatuses, st])}
            />
          );
        })}
      </Sheet>

      <Sheet visible={sortOpen} title={t("puspakom.sort.title")} subtitle={t("puspakom.sort.subtitle")} onClose={() => setSortOpen(false)}>
        {SORTS.map((k) => (
          <OptionRow
            key={k}
            label={t(`puspakom.sort.${k}`)}
            hint={t(`puspakom.sort.${k}Hint`)}
            selected={sort === k}
            round
            accent={accent}
            onPress={() => {
              setSort(k);
              setSortOpen(false);
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

function CountTile({ n, label, tone, onPress }: { n: number; label: string; tone: { bg: string; fg: string; border: string }; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.countTile, { backgroundColor: tone.bg, borderColor: tone.border }, pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.countN, { color: tone.fg }]}>{n}</Text>
      <Text style={[s.countLabel, { color: tone.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function MonthChip({ label, n, active, accent, onPress }: { label: string; n: number; active: boolean; accent: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.monthChip, active && { backgroundColor: accent, borderColor: accent }]}>
      <Text style={[s.monthChipLabel, active && { color: "#fff" }]}>{label}</Text>
      <Text style={[s.monthChipN, n === 0 && !active && { color: "#D1D5DB" }, active && { color: "#fff" }]}>{n}</Text>
    </Pressable>
  );
}

function OptionRow({
  label,
  hint,
  pill,
  count,
  selected,
  round,
  dim,
  accent,
  onPress,
}: {
  label?: string;
  hint?: string;
  pill?: React.ReactNode;
  count?: number;
  selected: boolean;
  round?: boolean;
  dim?: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.optRow, dim && { opacity: 0.45 }]}>
      <View style={[round ? s.radio : s.check, selected && { borderColor: accent, backgroundColor: round ? "#fff" : accent }]}>
        {selected && (round ? <View style={[s.radioDot, { backgroundColor: accent }]} /> : <FontAwesome5 name="check" size={10} color="#fff" />)}
      </View>
      <View style={{ flex: 1 }}>
        {pill ?? <Text style={s.optLabel}>{label}</Text>}
        {!!hint && <Text style={s.optHint}>{hint}</Text>}
      </View>
      {count != null && <Text style={s.optCount}>{count}</Text>}
    </Pressable>
  );
}

function BusCard({ bus, onPress }: { bus: PspBusState; onPress: () => void }) {
  const { t } = useI18n();
  const d = bus.days_to_due;
  let dueNote: string | null = null;
  let dueRed = false;
  if (bus.status === "FAILED_PENDING" && bus.open?.failed_on) {
    const items = bus.open.failed_checks.join(", ");
    dueNote = `${t("puspakom.failedOn", { date: fmtDayMonth(bus.open.failed_on) })}${items ? ` (${items})` : ""}`;
    dueRed = true;
  } else if (!bus.next_due) dueNote = t("puspakom.noPassYet");
  else if (d != null && d < 0) {
    dueNote = d === -1 ? t("puspakom.oneDayOverdue") : t("puspakom.daysOverdue", { count: -d });
    dueRed = true;
  } else if (d === 0) dueNote = t("puspakom.dueToday");
  else if (d === 1) dueNote = t("puspakom.dueTomorrow");
  else if (d != null) dueNote = t("puspakom.daysLeft", { count: d });

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}>
      <View style={s.cardHead}>
        <Text style={s.plate}>
          {bus.bus_id}
          {!!bus.bus_ev_no && <Text style={s.ev}> ({bus.bus_ev_no})</Text>}
        </Text>
        <FontAwesome5 name="chevron-right" size={12} color="#9CA3AF" />
      </View>
      <StatusPill status={bus.status} style={{ marginBottom: 10 }} />
      <View style={s.boxes}>
        <View style={s.box}>
          <Text style={s.boxLabel}>{t("puspakom.dueBy")}</Text>
          <Text style={s.boxValue}>{fmtDate(bus.next_due)}</Text>
          {!!dueNote && <Text style={[s.boxNote, dueRed && s.red]}>{dueNote}</Text>}
        </View>
        <View style={s.box}>
          <Text style={s.boxLabel}>{t("puspakom.inspection")}</Text>
          {bus.open ? (
            <>
              <Text style={s.boxValue}>{fmtShortDateTime(bus.open.scheduled_at)}</Text>
              <Text style={s.boxNote}>{t(`puspakom.type.${bus.open.inspection_type}`)}</Text>
            </>
          ) : (
            <>
              <Text style={s.boxValue}>{t("puspakom.notBooked")}</Text>
              {bus.status === "NOT_DUE" && bus.next_due && (
                <Text style={s.boxNote}>
                  {t("puspakom.reminderFrom", { date: fmtDayMonth(addDays(bus.next_due, -60)) })}
                </Text>
              )}
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, paddingBottom: 48, width: "100%", maxWidth: 640, alignSelf: "center" },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  h1: { fontSize: 24, fontWeight: "800", color: "#111827" },
  reportsBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#fff" },
  reportsBtnText: { fontSize: 13, fontWeight: "800" },
  sub: { fontSize: 13, color: "#6B7280", marginTop: 2, marginBottom: 14 },
  error: { backgroundColor: "#FEF2F2", borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { color: "#B91C1C", fontSize: 13 },
  countRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  countTile: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  countN: { fontSize: 24, fontWeight: "800" },
  countLabel: { fontSize: 12, fontWeight: "700" },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  monthCard: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 14 },
  monthHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  monthTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  monthHint: { fontSize: 12, color: "#9CA3AF" },
  monthChip: {
    minWidth: 52,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "#F9FAFB",
  },
  monthChipLabel: { fontSize: 11, fontWeight: "800", color: "#6B7280" },
  monthChipN: { fontSize: 17, fontWeight: "800", color: "#111827" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: "#111827" },
  filterRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  filterBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  filterLabel: { fontSize: 13, color: "#6B7280" },
  filterValue: { flex: 1, fontSize: 13, fontWeight: "700", color: "#111827" },
  listHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 4, marginBottom: 8 },
  listHeadTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  listHeadMeta: { fontSize: 12, color: "#6B7280" },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 10 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  plate: { fontSize: 17, fontWeight: "800", color: "#111827" },
  ev: { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  boxes: { flexDirection: "row", gap: 8 },
  box: { flex: 1, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 10 },
  boxLabel: { fontSize: 10, fontWeight: "800", color: "#6B7280", letterSpacing: 0.4, textTransform: "uppercase" },
  boxValue: { fontSize: 14, fontWeight: "800", color: "#111827", marginTop: 3 },
  boxNote: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  red: { color: "#B91C1C", fontWeight: "700" },
  empty: { textAlign: "center", color: "#6B7280", marginVertical: 20 },
  footer: { textAlign: "center", color: "#9CA3AF", fontSize: 12, marginTop: 10 },
  optRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  check: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  optLabel: { fontSize: 15, fontWeight: "700", color: "#111827" },
  optHint: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  optCount: { fontSize: 14, fontWeight: "700", color: "#6B7280" },
  sheetSecondary: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  sheetSecondaryText: { fontSize: 15, fontWeight: "700", color: "#374151" },
  sheetPrimary: { flex: 2, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  sheetPrimaryText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
