// PUSPAKOM Reports / KPIs (Fleet Manager screens 5 and 7; R&M Manager the
// same, view only). One report per completed inspection chain.

import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PspKpis, PspReport, puspakomApi } from "@/api/puspakom";
import { Card, StatTile, kpiStyles } from "@/components/kpi/KpiParts";
import DateTimeField from "@/components/puspakom/DateTimeField";
import Pill from "@/components/puspakom/Pill";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import Sheet from "@/components/Sheet";
import { useSession } from "@/ctx";
import { usePdfDownload } from "@/hooks/usePdfDownload";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useI18n } from "@/i18n/i18n-ctx";
import { STATUS_TONE, fmtDate, fmtDayDate, monthKey, monthLabel, mytDate } from "@/utils/puspakom";
import { ROLE_COLORS } from "@/utils/roles";

type Tab = "reports" | "kpis";
type PeriodKey = "thisMonth" | "last3" | "last6" | "thisYear" | "custom";
type ResultKey = "all" | "first" | "re";

const REINSPECTED_TONE = { bg: "#F0FDF4", fg: "#166534", border: "#86EFAC" };

/** Reports period on the first inspection date (spec 5b). */
function periodRange(k: PeriodKey, today: string, custom: { from: string; to: string }) {
  const [y, m] = today.split("-").map(Number);
  const first = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  const lastOfPrev = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  switch (k) {
    case "thisMonth":
      return { from: first(y, m), to: today };
    case "last3":
      return { from: first(y, m - 3), to: lastOfPrev };
    case "last6":
      return { from: first(y, m - 6), to: lastOfPrev };
    case "thisYear":
      return { from: `${y}-01-01`, to: today };
    case "custom":
      return custom;
  }
}

export default function PuspakomReportsScreen() {
  const params = useLocalSearchParams<{ tab?: string; bus?: string }>();
  const { t } = useI18n();
  const { dbUser } = useSession() as any;
  const accent = dbUser?.user_role === "rm_manager" ? ROLE_COLORS.rm_manager.accent : ROLE_COLORS.fleet_manager.accent;
  const [tab, setTab] = useState<Tab>(params.tab === "kpis" ? "kpis" : "reports");
  const [busFilter, setBusFilter] = useState<string[]>(params.bus ? [String(params.bus)] : []);

  return (
    <View style={s.page}>
      <View style={s.tabs}>
        {(["reports", "kpis"] as Tab[]).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && { borderBottomColor: accent }]}>
            <Text style={[s.tabText, tab === k && { color: accent }]}>{t(`puspakom.reports.tab_${k}`)}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "reports" ? (
        <ReportsTab accent={accent} busFilter={busFilter} setBusFilter={setBusFilter} />
      ) : (
        <KpisTab
          accent={accent}
          onBus={(busId) => {
            setBusFilter([busId]);
            setTab("reports");
          }}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------

function ReportsTab({ accent, busFilter, setBusFilter }: { accent: string; busFilter: string[]; setBusFilter: (b: string[]) => void }) {
  const router = useRouter();
  const { t } = useI18n();
  const projectId = useProjectFilter();
  const pdf = usePdfDownload();
  const today = mytDate();
  const [reports, setReports] = useState<PspReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("last6");
  const [custom, setCustom] = useState({ from: `${today.slice(0, 4)}-01-01`, to: today });
  const [result, setResult] = useState<ResultKey>("all");
  const [busOpen, setBusOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [draftBus, setDraftBus] = useState<string[]>([]);
  const [draftPeriod, setDraftPeriod] = useState<PeriodKey>("last6");
  const [busQ, setBusQ] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setReports((await puspakomApi.reports(projectId)).reports);
    } catch (e: any) {
      setError(e?.message ?? t("puspakom.loadError"));
    }
  }, [projectId, t]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const range = periodRange(period, today, custom);
  const inPeriod = (r: PspReport) => r.first_date >= range.from && r.first_date <= range.to;
  const buses = useMemo(() => {
    const map = new Map<string, { bus_id: string; bus_ev_no: string | null }>();
    for (const r of reports ?? []) map.set(r.bus_id, { bus_id: r.bus_id, bus_ev_no: r.bus_ev_no });
    const fleet = (e: string | null) => Number(String(e ?? "").replace(/\D/g, "")) || 1e9;
    return [...map.values()].sort((a, b) => fleet(a.bus_ev_no) - fleet(b.bus_ev_no) || a.bus_id.localeCompare(b.bus_id));
  }, [reports]);

  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (reports ?? []).filter(
      (r) =>
        inPeriod(r) &&
        (!busFilter.length || busFilter.includes(r.bus_id)) &&
        (!needle ||
          r.bus_id.toLowerCase().includes(needle) ||
          String(r.bus_ev_no ?? "").toLowerCase().includes(needle) ||
          String(r.ref_no ?? "").toLowerCase().includes(needle)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, q, busFilter, range.from, range.to]);
  const shown = base.filter((r) => result === "all" || (result === "first" ? r.first_time : !r.first_time));
  const groups = useMemo(() => {
    const map = new Map<string, PspReport[]>();
    for (const r of shown) map.set(monthKey(r.first_date), [...(map.get(monthKey(r.first_date)) ?? []), r]);
    return [...map.entries()];
  }, [shown]);

  const busLabel =
    busFilter.length === 0 ? t("puspakom.reports.allBuses") : busFilter.length === 1 ? busFilter[0] : t("puspakom.reports.nBuses", { count: busFilter.length });

  return (
    <>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <PuspakomMark />
        <Text style={s.h1}>{t("puspakom.reports.title")}</Text>
        <Text style={s.sub}>{t("puspakom.reports.intro")}</Text>
        {!!error && <Text style={s.error}>{error}</Text>}

        <View style={s.panel}>
          <View style={s.search}>
            <FontAwesome5 name="search" size={12} color="#9CA3AF" />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={t("puspakom.reports.search")}
              placeholderTextColor="#9CA3AF"
              style={s.searchInput}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
          <View style={s.filters}>
            <Pressable
              style={s.filter}
              onPress={() => {
                setDraftBus(busFilter);
                setBusOpen(true);
              }}
            >
              <FontAwesome5 name="bus" size={11} color="#374151" />
              <View style={{ flex: 1 }}>
                <Text style={s.filterLbl}>{t("puspakom.reports.bus")}</Text>
                <Text style={s.filterVal} numberOfLines={1}>
                  {busLabel}
                </Text>
              </View>
              <FontAwesome5 name="chevron-down" size={10} color="#6B7280" />
            </Pressable>
            <Pressable
              style={s.filter}
              onPress={() => {
                setDraftPeriod(period);
                setPeriodOpen(true);
              }}
            >
              <FontAwesome5 name="calendar-alt" size={11} color="#374151" />
              <View style={{ flex: 1 }}>
                <Text style={s.filterLbl}>{t("puspakom.reports.period")}</Text>
                <Text style={s.filterVal} numberOfLines={1}>
                  {t(`puspakom.reports.p_${period}`)}
                </Text>
              </View>
              <FontAwesome5 name="chevron-down" size={10} color="#6B7280" />
            </Pressable>
          </View>
          <View style={s.chips}>
            {(["all", "first", "re"] as ResultKey[]).map((k) => {
              const n = base.filter((r) => k === "all" || (k === "first" ? r.first_time : !r.first_time)).length;
              return (
                <Pressable key={k} onPress={() => setResult(k)} style={[s.chip, result === k && { backgroundColor: accent, borderColor: accent }]}>
                  <Text style={[s.chipText, result === k && { color: "#fff" }]}>
                    {t(`puspakom.reports.r_${k}`)} {n}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {!reports && !error && <ActivityIndicator style={{ marginTop: 20 }} />}
        {groups.map(([month, list]) => (
          <View key={month}>
            <Text style={s.month}>{monthLabel(month).toUpperCase()}</Text>
            {list.map((r) => (
              <Pressable key={r.root_inspection_id} style={s.card} onPress={() => router.push(`/puspakom/report/${r.root_inspection_id}` as any)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.plate}>
                    {r.bus_id}
                    {!!r.bus_ev_no && <Text style={s.ev}> ({r.bus_ev_no})</Text>}
                  </Text>
                  <View style={s.pillRow}>
                    <Pill small label={r.first_time ? t("puspakom.status.PASSED") : t("puspakom.reports.passedAfterRe")} tone={r.first_time ? STATUS_TONE.PASSED : REINSPECTED_TONE} />
                    <Text style={s.type}>{t(`puspakom.typeLong.${r.inspection_type}`)}</Text>
                  </View>
                  <Text style={s.date}>
                    {r.first_time ? fmtDayDate(r.first_date) : `${fmtDayDate(r.first_date)} → ${fmtDayDate(r.passed_date)}`}
                  </Text>
                  <Text style={s.ref}>{r.ref_no ?? "—"}</Text>
                </View>
                <Pressable
                  hitSlop={8}
                  style={s.share}
                  disabled={pdf.busy}
                  onPress={() => pdf.run(() => puspakomApi.reportPdf(r.root_inspection_id))}
                >
                  <FontAwesome5 name="share-square" size={13} color={accent} />
                </Pressable>
                <FontAwesome5 name="chevron-right" size={12} color="#9CA3AF" />
              </Pressable>
            ))}
          </View>
        ))}
        {reports && shown.length === 0 && <Text style={s.empty}>{t("puspakom.reports.empty")}</Text>}
        {pdf.busy && <Text style={s.pdfBusy}>{t("pdf.preparing")}</Text>}
        <Text style={s.foot}>{t("puspakom.reports.footer")}</Text>
      </ScrollView>

      <Sheet
        visible={busOpen}
        tall
        title={t("puspakom.reports.bus")}
        subtitle={t("puspakom.reports.busSub")}
        onClose={() => setBusOpen(false)}
        footer={
          <>
            <Pressable style={s.sheetSecondary} onPress={() => setDraftBus([])}>
              <Text style={s.sheetSecondaryText}>{t("puspakom.statusSheet.reset")}</Text>
            </Pressable>
            <Pressable
              style={[s.sheetPrimary, { backgroundColor: accent }]}
              onPress={() => {
                setBusFilter(draftBus);
                setBusOpen(false);
              }}
            >
              <Text style={s.sheetPrimaryText}>
                {t("puspakom.reports.showN", {
                  count: (reports ?? []).filter((r) => inPeriod(r) && (!draftBus.length || draftBus.includes(r.bus_id))).length,
                })}
              </Text>
            </Pressable>
          </>
        }
      >
        <TextInput
          value={busQ}
          onChangeText={setBusQ}
          placeholder={t("puspakom.search")}
          placeholderTextColor="#9CA3AF"
          style={s.sheetSearch}
          autoCapitalize="characters"
        />
        <OptRow label={t("puspakom.reports.allBuses")} on={draftBus.length === 0} round accent={accent} onPress={() => setDraftBus([])} />
        {buses
          .filter((b) => !busQ || `${b.bus_id} ${b.bus_ev_no ?? ""}`.toLowerCase().includes(busQ.toLowerCase()))
          .map((b) => {
            const on = draftBus.includes(b.bus_id);
            return (
              <OptRow
                key={b.bus_id}
                label={`${b.bus_id}${b.bus_ev_no ? ` (${b.bus_ev_no})` : ""}`}
                count={(reports ?? []).filter((r) => r.bus_id === b.bus_id && inPeriod(r)).length}
                on={on}
                accent={accent}
                onPress={() => setDraftBus(on ? draftBus.filter((x) => x !== b.bus_id) : [...draftBus, b.bus_id])}
              />
            );
          })}
      </Sheet>

      <Sheet
        visible={periodOpen}
        title={t("puspakom.reports.period")}
        subtitle={t("puspakom.reports.periodSub")}
        onClose={() => setPeriodOpen(false)}
        footer={
          <>
            <Pressable style={s.sheetSecondary} onPress={() => setDraftPeriod("last6")}>
              <Text style={s.sheetSecondaryText}>{t("puspakom.statusSheet.reset")}</Text>
            </Pressable>
            <Pressable
              style={[s.sheetPrimary, { backgroundColor: accent }]}
              onPress={() => {
                setPeriod(draftPeriod);
                setPeriodOpen(false);
              }}
            >
              <Text style={s.sheetPrimaryText}>
                {t("puspakom.reports.showN", {
                  count: (reports ?? []).filter((r) => {
                    const rr = periodRange(draftPeriod, today, custom);
                    return r.first_date >= rr.from && r.first_date <= rr.to && (!busFilter.length || busFilter.includes(r.bus_id));
                  }).length,
                })}
              </Text>
            </Pressable>
          </>
        }
      >
        {(["thisMonth", "last3", "last6", "thisYear", "custom"] as PeriodKey[]).map((k) => {
          const rr = periodRange(k, today, custom);
          return (
            <OptRow
              key={k}
              label={t(`puspakom.reports.p_${k}`)}
              hint={k === "custom" ? t("puspakom.reports.customHint") : `${fmtDate(rr.from)} – ${fmtDate(rr.to)}`}
              count={(reports ?? []).filter((r) => r.first_date >= rr.from && r.first_date <= rr.to && (!busFilter.length || busFilter.includes(r.bus_id))).length}
              on={draftPeriod === k}
              round
              accent={accent}
              onPress={() => setDraftPeriod(k)}
            />
          );
        })}
        {draftPeriod === "custom" && (
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <DateTimeField mode="date" label={t("puspakom.reports.from")} value={custom.from} maximumDate={custom.to} onChange={(v) => setCustom({ ...custom, from: v })} />
            <DateTimeField mode="date" label={t("puspakom.reports.to")} value={custom.to} minimumDate={custom.from} maximumDate={today} onChange={(v) => setCustom({ ...custom, to: v })} />
          </View>
        )}
        <View style={{ height: 12 }} />
      </Sheet>
    </>
  );
}

function OptRow({ label, hint, count, on, round, accent, onPress }: { label: string; hint?: string; count?: number; on: boolean; round?: boolean; accent: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.optRow}>
      <View style={[round ? s.radio : s.check, on && { borderColor: accent, backgroundColor: round ? "#fff" : accent }]}>
        {on && (round ? <View style={[s.radioDot, { backgroundColor: accent }]} /> : <FontAwesome5 name="check" size={10} color="#fff" />)}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.optLabel}>{label}</Text>
        {!!hint && <Text style={s.optHint}>{hint}</Text>}
      </View>
      {count != null && <Text style={s.optCount}>{count}</Text>}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

function KpisTab({ accent, onBus }: { accent: string; onBus: (busId: string) => void }) {
  const { t } = useI18n();
  const projectId = useProjectFilter();
  const [period, setPeriod] = useState<"6m" | "12m" | "all">("6m");
  const [data, setData] = useState<PspKpis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    puspakomApi
      .kpis(period, projectId)
      .then(setData)
      .catch((e) => setError(e?.message ?? t("puspakom.loadError")));
  }, [period, projectId, t]);

  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
  const maxMonth = Math.max(1, ...(data?.per_month ?? []).map((m) => m.passed + m.failed));
  const maxItem = Math.max(1, ...(data?.failed_items ?? []).map((f) => f.count));

  return (
    <ScrollView contentContainerStyle={s.content}>
      <PuspakomMark />
      <Text style={s.h1}>{t("puspakom.kpis.title")}</Text>
      <View style={s.seg}>
        {(["6m", "12m", "all"] as const).map((k) => (
          <Pressable key={k} onPress={() => setPeriod(k)} style={[s.segBtn, period === k && s.segOn]}>
            <Text style={[s.segText, period === k && { color: "#111827" }]}>{t(`puspakom.kpis.p_${k}`)}</Text>
          </Pressable>
        ))}
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}
      {!data ? (
        <ActivityIndicator style={{ marginTop: 20 }} />
      ) : (
        <>
          <Text style={s.range}>
            {fmtDate(data.period.from)} – {fmtDate(data.period.to)}
          </Text>
          <View style={kpiStyles.tilesRow}>
            <StatTile
              label={t("puspakom.kpis.firstTime")}
              value={pct(data.first_time.passed, data.first_time.attempts)}
              sub={t("puspakom.kpis.firstTimeSub", { passed: data.first_time.passed, total: data.first_time.attempts })}
            />
            <StatTile
              label={t("puspakom.kpis.inspections")}
              value={String(data.inspections.total)}
              sub={t("puspakom.kpis.inspectionsSub", data.inspections)}
            />
          </View>
          <View style={[kpiStyles.tilesRow, { marginTop: 10 }]}>
            <StatTile
              label={t("puspakom.kpis.failed")}
              value={String(data.failed.count)}
              highlight={data.failed.count > 0}
              sub={
                data.failed.buses.length === 1
                  ? `${data.failed.buses[0].bus_id} · ${data.failed.buses[0].items.join(", ")}`
                  : data.failed.buses.length
                    ? t("puspakom.reports.nBuses", { count: data.failed.buses.length })
                    : null
              }
              subTone="bad"
            />
            <StatTile
              label={t("puspakom.kpis.onTime")}
              value={pct(data.on_time.on_time, data.on_time.total)}
              sub={t("puspakom.kpis.onTimeSub", { n: data.on_time.on_time, total: data.on_time.total })}
            />
          </View>

          <Card
            title={t("puspakom.kpis.perMonth")}
            subtitle={t("puspakom.kpis.perMonthSub")}
            right={
              <View style={s.legend}>
                <View style={[s.dot, { backgroundColor: "#16A34A" }]} />
                <Text style={s.legendText}>{t("puspakom.bus.passed")}</Text>
                <View style={[s.dot, { backgroundColor: "#DC2626" }]} />
                <Text style={s.legendText}>{t("puspakom.bus.failed")}</Text>
              </View>
            }
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={s.chart}>
                {data.per_month.map((m) => {
                  const total = m.passed + m.failed;
                  return (
                    <View key={m.month} style={s.col}>
                      <Text style={s.colN}>{total}</Text>
                      <View style={s.colTrack}>
                        <View style={{ height: `${(m.failed / maxMonth) * 100}%`, backgroundColor: "#DC2626", borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                        <View style={{ height: `${(m.passed / maxMonth) * 100}%`, backgroundColor: "#16A34A" }} />
                      </View>
                      <Text style={s.colLbl}>{monthLabel(m.month, false).slice(0, 3)}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </Card>

          <Card title={t("puspakom.kpis.failedItems")} subtitle={t("puspakom.kpis.failedItemsSub")}>
            {data.failed_items.length === 0 ? (
              <Text style={s.muted}>{t("puspakom.kpis.noFails")}</Text>
            ) : (
              data.failed_items.map((f) => (
                <View key={f.check_id} style={[s.itemRow, f.count === 0 && { opacity: 0.4 }]}>
                  <Text style={s.itemLbl} numberOfLines={2}>
                    {f.check_id} {f.label}
                  </Text>
                  <View style={s.itemTrack}>
                    <View style={{ width: `${(f.count / maxItem) * 100}%`, height: 8, borderRadius: 4, backgroundColor: "#DC2626" }} />
                  </View>
                  <Text style={s.itemN}>{f.count}</Text>
                </View>
              ))
            )}
            <View style={s.avgRow}>
              <Text style={s.muted}>{t("puspakom.kpis.avgFailToRe")}</Text>
              <Text style={s.avgVal}>{data.avg_fail_to_re_days == null ? "—" : t("puspakom.kpis.days", { count: data.avg_fail_to_re_days })}</Text>
            </View>
          </Card>

          <Card title={t("puspakom.kpis.byBus")} subtitle={t("puspakom.kpis.byBusSub")}>
            <View style={s.tblHead}>
              <Text style={[s.th, { flex: 1, textAlign: "left" }]}>{t("puspakom.kpis.colBus")}</Text>
              <Text style={s.th}>{t("puspakom.kpis.colInsp")}</Text>
              <Text style={s.th}>{t("puspakom.kpis.colFails")}</Text>
              <Text style={[s.th, { width: 56 }]}>{t("puspakom.kpis.colFirst")}</Text>
            </View>
            {data.by_bus.map((b) => (
              <Pressable key={b.bus_id} style={s.tr} onPress={() => onBus(b.bus_id)}>
                <Text style={[s.td, { flex: 1, fontWeight: "800", textAlign: "left" }]}>
                  {b.bus_id}
                  {!!b.bus_ev_no && <Text style={s.ev}> ({b.bus_ev_no})</Text>}
                </Text>
                <Text style={s.td}>{b.inspections}</Text>
                <Text style={[s.td, b.fails > 0 && { color: "#B91C1C", fontWeight: "800" }]}>{b.fails}</Text>
                <View style={{ width: 56, alignItems: "center" }}>
                  {b.first_time == null ? (
                    <Text style={s.td}>—</Text>
                  ) : (
                    <Pill small label={b.first_time ? t("puspakom.kpis.yes") : t("puspakom.kpis.no")} tone={b.first_time ? STATUS_TONE.PASSED : STATUS_TONE.FAILED_PENDING} />
                  )}
                </View>
              </Pressable>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { fontSize: 14, fontWeight: "800", color: "#6B7280" },
  content: { padding: 16, paddingBottom: 48, width: "100%", maxWidth: 640, alignSelf: "center" },
  h1: { fontSize: 22, fontWeight: "800", color: "#111827", marginTop: 6 },
  sub: { fontSize: 13, color: "#6B7280", marginTop: 2, marginBottom: 12 },
  error: { color: "#B91C1C", fontSize: 13, marginVertical: 8 },
  panel: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 12 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: "#111827" },
  filters: { flexDirection: "row", gap: 8, marginTop: 8 },
  filter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 9 },
  filterLbl: { fontSize: 9, fontWeight: "800", color: "#6B7280", textTransform: "uppercase" },
  filterVal: { fontSize: 13, fontWeight: "800", color: "#111827" },
  chips: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: "800", color: "#374151" },
  month: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.5, marginTop: 6, marginBottom: 6 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 8 },
  plate: { fontSize: 15, fontWeight: "800", color: "#111827" },
  ev: { fontSize: 12, fontWeight: "600", color: "#6B7280" },
  pillRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  type: { fontSize: 12, color: "#6B7280" },
  date: { fontSize: 12, color: "#374151", marginTop: 4 },
  ref: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  share: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  empty: { textAlign: "center", color: "#6B7280", marginVertical: 20 },
  pdfBusy: { textAlign: "center", color: "#6B7280", fontSize: 12, marginTop: 6 },
  foot: { textAlign: "center", color: "#9CA3AF", fontSize: 12, marginTop: 10 },
  sheetSearch: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, marginBottom: 4 },
  optRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  check: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  optLabel: { fontSize: 15, fontWeight: "700", color: "#111827" },
  optHint: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  optCount: { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  sheetSecondary: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  sheetSecondaryText: { fontSize: 15, fontWeight: "700", color: "#374151" },
  sheetPrimary: { flex: 2, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  sheetPrimaryText: { fontSize: 15, fontWeight: "800", color: "#fff" },
  seg: { flexDirection: "row", backgroundColor: "#F3F4F6", borderRadius: 12, padding: 3, marginTop: 12 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10 },
  segOn: { backgroundColor: "#fff" },
  segText: { fontSize: 13, fontWeight: "800", color: "#6B7280" },
  range: { textAlign: "center", fontSize: 13, fontWeight: "800", color: "#111827", marginVertical: 10 },
  legend: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 2, marginLeft: 6 },
  legendText: { fontSize: 11, color: "#6B7280" },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 12, height: 150, paddingTop: 6 },
  col: { width: 30, alignItems: "center", height: "100%" },
  colN: { fontSize: 11, fontWeight: "800", color: "#111827" },
  colTrack: { flex: 1, width: 18, justifyContent: "flex-end", marginVertical: 4 },
  colLbl: { fontSize: 10, color: "#6B7280" },
  muted: { fontSize: 13, color: "#6B7280" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  itemLbl: { width: 110, fontSize: 12, color: "#111827" },
  itemTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "#F3F4F6" },
  itemN: { width: 22, textAlign: "right", fontSize: 13, fontWeight: "800" },
  avgRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 10, marginTop: 6 },
  avgVal: { fontSize: 13, fontWeight: "800", color: "#111827" },
  tblHead: { flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  th: { width: 48, textAlign: "center", fontSize: 10, fontWeight: "800", color: "#6B7280", textTransform: "uppercase" },
  tr: { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  td: { width: 48, textAlign: "center", fontSize: 13, color: "#111827" },
});
