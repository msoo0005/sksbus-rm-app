// Performance & KPIs: how fast breakdowns get fixed, where the time goes,
// which issues and which buses come up most. Two tabs, Overview and By bus,
// over one period (7 days, a month or a year). Export opens the PDF reports.
//
// All figures come from the server (GET /kpis/overview, /kpis/buses), which
// counts every report in the period, not just the ones a list screen loaded.

import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { api, type IssueType, type KpiBuses, type KpiOverview } from "@/api/client";
import { BarRow, Card, Chip, KPI_GREEN, PeriodBar, StatTile, kpiStyles } from "@/components/kpi/KpiParts";
import SortChips from "@/components/SortChips";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useI18n } from "@/i18n/i18n-ctx";
import { formatBusLabel } from "@/utils/busLabel";
import { busSystemLabel } from "@/utils/busSystems";
import { fmtDur, pct, periodFor, PeriodKind, previousPeriodLabel } from "@/utils/kpiPeriod";

type Tab = "overview" | "buses";
const ISSUES_SHOWN = 8;
type BusSortKey = "jobs" | "downtime" | "fleet";

const STAGE_COLOURS = ["#C2410C", "#E8A33D", "#86C79A", KPI_GREEN];

export default function PerformanceScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const projectId = useProjectFilter();

  const [tab, setTab] = useState<Tab>("overview");
  const [kind, setKind] = useState<PeriodKind>("month");
  const [offset, setOffset] = useState(0);
  const period = useMemo(() => periodFor(kind, offset), [kind, offset]);

  const [overview, setOverview] = useState<KpiOverview | null>(null);
  const [buses, setBuses] = useState<KpiBuses | null>(null);
  const [issueFilter, setIssueFilter] = useState<IssueType | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [busSort, setBusSort] = useState<{ key: BusSortKey; reversed: boolean }>({ key: "jobs", reversed: false });

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const range = { from: period.from.toISOString(), to: period.to.toISOString(), project_id: projectId };
      try {
        const [o, b] = await Promise.all([
          api.kpiOverview(range),
          api.kpiBuses({ ...range, issue_type: issueFilter }),
        ]);
        setOverview(o);
        setBuses(b);
      } catch (e: any) {
        setError(e?.message ?? t("common.unknownError"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [period, projectId, issueFilter, t],
  );

  useEffect(() => {
    load();
  }, [load]);

  const changeKind = (k: PeriodKind) => {
    setKind(k);
    setOffset(0);
  };
  const step = (d: 1 | -1) => setOffset((o) => Math.min(0, o + d));

  const busRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (buses?.buses ?? []).filter(
      (b) => !q || String(b.bus_id).toLowerCase().includes(q) || String(b.bus_ev_no ?? "").toLowerCase().includes(q),
    );
    const sign = busSort.reversed ? -1 : 1;
    return [...list].sort((a, b) => {
      if (busSort.key === "jobs") return (b.jobs - a.jobs) * sign || b.downtime_ms - a.downtime_ms;
      if (busSort.key === "downtime") return (b.downtime_ms - a.downtime_ms) * sign;
      return String(a.bus_ev_no ?? "~").localeCompare(String(b.bus_ev_no ?? "~"), undefined, { numeric: true }) * sign;
    });
  }, [buses, search, busSort]);

  const openBus = (busId: string) =>
    router.push({ pathname: "/performance/bus/[busId]", params: { busId, kind, offset: String(offset) } } as any);

  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      keyboardShouldPersistTaps="handled"
    >
      {/* Tabs + Export */}
      <View style={s.topRow}>
        <View style={s.tabs}>
          {(["overview", "buses"] as Tab[]).map((k) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabActive]}>
              <Text style={[s.tabText, tab === k && s.tabTextActive]}>
                {k === "overview" ? t("performance.tabOverview") : t("performance.tabByBus")}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={({ pressed }) => [s.exportBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.push("/performance/export" as any)}
        >
          <FontAwesome5 name="download" size={12} color={KPI_GREEN} />
          <Text style={s.exportText}>{t("performance.export")}</Text>
        </Pressable>
      </View>

      <PeriodBar period={period} onKind={changeKind} onStep={step} />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={s.errorBox}>
          <Text style={s.errorTitle}>{t("performance.loadFailed")}</Text>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : tab === "overview" && overview ? (
        <Overview
          o={overview}
          periodName={previousPeriodLabel(period)}
          bucketNote={t(`performance.bucketNote_${kind}`)}
          onIssue={(k) => {
            setIssueFilter(k);
            setTab("buses");
          }}
          onBus={openBus}
          onAllBuses={() => {
            setIssueFilter(null);
            setTab("buses");
          }}
        />
      ) : (
        <View style={{ gap: 12 }}>
          <View style={s.searchWrap}>
            <FontAwesome5 name="search" size={13} color="#9CA3AF" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t("performance.searchBuses")}
              placeholderTextColor="#9CA3AF"
              style={s.search}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
          {issueFilter && (
            <View style={s.filterRow}>
              <Chip
                label={`${busSystemLabel(issueFilter, t)}  ✕`}
                active
                onPress={() => setIssueFilter(null)}
              />
            </View>
          )}
          <SortChips<BusSortKey>
            value={busSort}
            onChange={setBusSort}
            keys={["jobs", "downtime", "fleet"]}
            labels={{
              jobs: t("performance.sortMostJobs"),
              downtime: t("performance.sortDowntime"),
              fleet: t("performance.sortFleetNo"),
            }}
          />
          <Text style={s.countLine}>
            {t("performance.busCountLine", { buses: busRows.length, jobs: buses?.total_jobs ?? 0 })}
          </Text>
          {busRows.length === 0 ? (
            <Text style={s.empty}>{t("performance.noJobs")}</Text>
          ) : (
            busRows.map((b) => (
              <Pressable key={b.bus_id} style={({ pressed }) => [s.busRow, pressed && { opacity: 0.7 }]} onPress={() => openBus(b.bus_id)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.busPlate}>
                    {b.bus_id}
                    {!!b.bus_ev_no && <Text style={s.busEv}>{` (${b.bus_ev_no})`}</Text>}
                  </Text>
                  {!!b.last_issue && (
                    <Text style={s.busMeta} numberOfLines={1}>
                      {t("performance.lastIssue", { value: b.last_issue })}
                    </Text>
                  )}
                  <Text style={s.busMeta}>
                    {t("performance.lastReportLine", {
                      date: b.last_report_at
                        ? new Date(b.last_report_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })
                        : "—",
                      downtime: fmtDur(b.downtime_ms),
                    })}
                  </Text>
                </View>
                <View style={s.jobsPill}>
                  <Text style={s.jobsPillText}>{t("performance.jobsCount", { count: b.jobs })}</Text>
                </View>
                <FontAwesome5 name="chevron-right" size={12} color="#9CA3AF" />
              </Pressable>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

function Overview({
  o,
  periodName,
  bucketNote,
  onIssue,
  onBus,
  onAllBuses,
}: {
  o: KpiOverview;
  periodName: string;
  bucketNote: string;
  onIssue: (k: IssueType) => void;
  onBus: (busId: string) => void;
  onAllBuses: () => void;
}) {
  const { t } = useI18n();
  const closedDelta = o.jobs_closed - o.prev_jobs_closed;
  const turnDelta =
    o.avg_turnaround_ms != null && o.prev_avg_turnaround_ms != null ? o.avg_turnaround_ms - o.prev_avg_turnaround_ms : null;

  const stages = [
    { label: t("performance.stageApproval"), ms: o.avg_approval_ms },
    { label: t("performance.stageAccept"), ms: o.avg_accept_ms },
    { label: t("performance.stageTravel"), ms: o.avg_travel_ms },
    { label: t("performance.stageRepair"), ms: o.avg_repair_ms },
  ];
  const stageTotal = stages.reduce((sum, x) => sum + (x.ms ?? 0), 0);
  const maxBucket = Math.max(1, ...o.buckets.flatMap((b) => [b.opened, b.closed]));
  const maxIssue = Math.max(1, ...o.issues.map((x) => x.count));
  // 29 categories: show the top few, the rest on request.
  const [allIssues, setAllIssues] = useState(false);
  const maxBus = Math.max(1, ...o.top_buses.map((x) => x.jobs));

  const bucketLabel = (iso: string) => {
    const d = new Date(iso);
    return o.bucket_unit === "month"
      ? d.toLocaleDateString(undefined, { month: "short" })
      : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={kpiStyles.tilesRow}>
        <StatTile
          label={t("performance.jobsClosed")}
          value={String(o.jobs_closed)}
          sub={
            closedDelta === 0
              ? t("performance.sameAs", { period: periodName })
              : `${closedDelta > 0 ? "▲" : "▼"} ${Math.abs(closedDelta)} ${t("performance.vs", { period: periodName })}`
          }
          subTone={closedDelta >= 0 ? "good" : "bad"}
        />
        <StatTile
          label={t("performance.avgTurnaround")}
          value={fmtDur(o.avg_turnaround_ms)}
          sub={
            turnDelta == null || Math.abs(turnDelta) < 60000
              ? null
              : turnDelta < 0
                ? `▼ ${fmtDur(-turnDelta)} ${t("performance.faster")}`
                : `▲ ${fmtDur(turnDelta)} ${t("performance.slower")}`
          }
          subTone={turnDelta != null && turnDelta < 0 ? "good" : "bad"}
        />
      </View>
      <View style={kpiStyles.tilesRow}>
        <StatTile
          label={t("performance.avgApprovalWait")}
          value={fmtDur(o.avg_approval_ms)}
          sub={
            pct(o.avg_approval_ms, o.avg_turnaround_ms) != null
              ? t("performance.ofTurnaround", { pct: pct(o.avg_approval_ms, o.avg_turnaround_ms) ?? 0 })
              : null
          }
          subTone="warn"
          highlight
        />
        <StatTile label={t("performance.avgRepairTime")} value={fmtDur(o.avg_repair_ms)} sub={t("performance.onSitePerJob")} />
      </View>

      <Card title={t("performance.timeGoesTitle")} subtitle={t("performance.timeGoesSub")}>
        {stageTotal === 0 ? (
          <Text style={s.empty}>{t("performance.noClosedJobs")}</Text>
        ) : (
          <>
            <View style={s.stack}>
              {stages.map((x, i) =>
                x.ms ? <View key={i} style={{ flex: x.ms, backgroundColor: STAGE_COLOURS[i] }} /> : null,
              )}
            </View>
            {stages.map((x, i) => (
              <View key={i} style={s.legendRow}>
                <View style={[s.legendDot, { backgroundColor: STAGE_COLOURS[i] }]} />
                <Text style={s.legendLabel}>{x.label}</Text>
                <Text style={s.legendValue}>{fmtDur(x.ms)}</Text>
                <Text style={s.legendPct}>{pct(x.ms, stageTotal) != null ? `${pct(x.ms, stageTotal)}%` : "—"}</Text>
              </View>
            ))}
          </>
        )}
      </Card>

      <Card
        title={t(`performance.jobsPer_${o.bucket_unit}`)}
        subtitle={t("performance.openedVsClosed")}
        right={
          <View style={s.chartLegend}>
            <View style={[s.legendSq, { backgroundColor: "#D1D5DB" }]} />
            <Text style={s.chartLegendText}>{t("performance.opened")}</Text>
            <View style={[s.legendSq, { backgroundColor: KPI_GREEN }]} />
            <Text style={s.chartLegendText}>{t("performance.closed")}</Text>
          </View>
        }
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chart}>
          {o.buckets.map((b) => (
            <View key={b.start} style={s.chartCol}>
              <View style={s.chartBars}>
                {[
                  { v: b.opened, c: "#D1D5DB" },
                  { v: b.closed, c: KPI_GREEN },
                ].map((bar, i) => (
                  <View key={i} style={s.chartBarWrap}>
                    <Text style={[s.chartNum, i === 1 && { color: KPI_GREEN }]}>{bar.v}</Text>
                    <View style={[s.chartBar, { height: Math.max(2, (bar.v / maxBucket) * 90), backgroundColor: bar.c }]} />
                  </View>
                ))}
              </View>
              <Text style={s.chartLabel}>{bucketLabel(b.start)}</Text>
            </View>
          ))}
        </ScrollView>
        <Text style={s.note}>{bucketNote}</Text>
      </Card>

      <Card title={t("performance.commonIssues")} subtitle={t("performance.commonIssuesSub", { count: o.jobs_opened })}>
        {o.issues.length === 0 ? (
          <Text style={s.empty}>{t("performance.noJobs")}</Text>
        ) : (
          <>
            {(allIssues ? o.issues : o.issues.slice(0, ISSUES_SHOWN)).map((x) => (
              <BarRow
                key={x.issue_type}
                label={busSystemLabel(x.issue_type, t)}
                value={x.count}
                max={maxIssue}
                onPress={() => onIssue(x.issue_type)}
                wide
              />
            ))}
            {o.issues.length > ISSUES_SHOWN && (
              <Pressable onPress={() => setAllIssues((v) => !v)} style={s.showAll}>
                <Text style={s.showAllText}>
                  {allIssues ? t("performance.showFewer") : t("performance.showAllCount", { count: o.issues.length })}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </Card>

      <Card title={t("performance.mostBreakdowns")} subtitle={t("performance.mostBreakdownsSub")}>
        {o.top_buses.length === 0 ? (
          <Text style={s.empty}>{t("performance.noJobs")}</Text>
        ) : (
          o.top_buses.slice(0, 3).map((b) => (
            <BarRow
              key={b.bus_id}
              label={formatBusLabel(b.bus_id, b.bus_ev_no)}
              value={b.jobs}
              max={maxBus}
              right={t("performance.jobsCount", { count: b.jobs })}
              onPress={() => onBus(b.bus_id)}
              bold
            />
          ))
        )}
        <Pressable style={({ pressed }) => [s.seeAll, pressed && { opacity: 0.7 }]} onPress={onAllBuses}>
          <Text style={s.seeAllText}>{t("performance.seeAllBuses")}</Text>
          <FontAwesome5 name="arrow-right" size={12} color={KPI_GREEN} />
        </Pressable>
      </Card>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F3F4F6" },
  content: { padding: 16, gap: 12, paddingBottom: 40, width: "100%", maxWidth: 760, alignSelf: "center" },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  tabs: { flex: 1, flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2.5, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: KPI_GREEN },
  tabText: { fontSize: 15, fontWeight: "600", color: "#6B7280" },
  tabTextActive: { color: "#111827", fontWeight: "800" },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  exportText: { fontSize: 13, fontWeight: "700", color: KPI_GREEN },
  errorBox: { backgroundColor: "#FEF2F2", borderRadius: 14, padding: 14 },
  errorTitle: { fontWeight: "800", color: "#B91C1C" },
  errorText: { color: "#7F1D1D", marginTop: 4 },
  empty: { color: "#6B7280", fontSize: 13, paddingVertical: 6 },
  stack: { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", gap: 2, marginBottom: 10 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { flex: 1, fontSize: 13, color: "#111827" },
  legendValue: { fontSize: 13, fontWeight: "800", color: "#111827", minWidth: 56, textAlign: "right" },
  legendPct: { fontSize: 12, color: "#6B7280", minWidth: 36, textAlign: "right" },
  chartLegend: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendSq: { width: 9, height: 9, borderRadius: 2 },
  chartLegendText: { fontSize: 11, color: "#6B7280", marginRight: 4 },
  chart: { gap: 14, paddingTop: 8, alignItems: "flex-end" },
  chartCol: { alignItems: "center", minWidth: 44 },
  chartBars: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 112 },
  chartBarWrap: { alignItems: "center", justifyContent: "flex-end" },
  chartNum: { fontSize: 10, fontWeight: "700", color: "#6B7280", marginBottom: 3 },
  chartBar: { width: 14, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  chartLabel: { fontSize: 11, color: "#6B7280", marginTop: 6 },
  note: { fontSize: 11, color: "#9CA3AF", marginTop: 10 },
  showAll: { alignItems: "center", paddingTop: 8 },
  showAllText: { fontSize: 13, fontWeight: "700", color: KPI_GREEN },
  seeAll: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F0FDF4",
    borderRadius: 12,
    paddingVertical: 12,
  },
  seeAllText: { fontSize: 14, fontWeight: "700", color: KPI_GREEN },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  search: { flex: 1, paddingVertical: 11, fontSize: 15, color: "#111827" },
  filterRow: { flexDirection: "row" },
  countLine: { fontSize: 13, color: "#6B7280" },
  busRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
  },
  busPlate: { fontSize: 16, fontWeight: "800", color: "#111827" },
  busEv: { color: KPI_GREEN, fontWeight: "700" },
  busMeta: { fontSize: 12, color: "#6B7280", marginTop: 3 },
  jobsPill: { backgroundColor: "#F0FDF4", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  jobsPillText: { fontSize: 12, fontWeight: "800", color: KPI_GREEN },
});
