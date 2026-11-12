// Bus history: one bus's jobs, downtime and issues over a period, and every
// report it has had, each with View report and the Job Completion Report PDF.

import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { api, type IssueType, type KpiBusHistory, type KpiReportRow } from "@/api/client";
import { BarRow, Card, Chip, KPI_GREEN, PeriodBar } from "@/components/kpi/KpiParts";
import { usePdfDownload } from "@/hooks/usePdfDownload";
import { useI18n } from "@/i18n/i18n-ctx";
import { busSystemLabel } from "@/utils/busSystems";
import { fmtDur, periodFor, PeriodKind } from "@/utils/kpiPeriod";
import { reportTypeTitleLabel } from "@/utils/reportType";

const PAGE = 10;
type StatusFilter = "all" | "open" | "closed";

export default function BusHistoryScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const pdf = usePdfDownload();
  const params = useLocalSearchParams<{ busId: string; kind?: PeriodKind; offset?: string }>();
  const busId = String(params.busId ?? "");

  const [kind, setKind] = useState<PeriodKind>((params.kind as PeriodKind) || "month");
  const [offset, setOffset] = useState(Math.min(0, Number(params.offset ?? 0) || 0));
  const period = useMemo(() => periodFor(kind, offset), [kind, offset]);

  const [data, setData] = useState<KpiBusHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [issue, setIssue] = useState<IssueType | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.kpiBus(busId, { from: period.from.toISOString(), to: period.to.toISOString() }));
    } catch (e: any) {
      setError(e?.message ?? t("common.unknownError"));
    } finally {
      setLoading(false);
    }
  }, [busId, period, t]);

  useEffect(() => {
    load();
    setShown(PAGE);
  }, [load]);

  const reports = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.reports ?? []).filter((r) => {
      if (issue !== "all" && r.issue_type !== issue) return false;
      if (status === "closed" && r.status !== "closed") return false;
      if (status === "open" && r.status === "closed") return false;
      if (!needle) return true;
      return [r.issue, String(r.report_id), r.technician_name, r.job_ref_no].some((x) =>
        String(x ?? "").toLowerCase().includes(needle),
      );
    });
  }, [data, q, issue, status]);

  // Group the visible reports by month, newest first.
  const groups = useMemo(() => {
    const out: { label: string; rows: KpiReportRow[] }[] = [];
    for (const r of reports.slice(0, shown)) {
      const label = new Date(r.reported_at).toLocaleDateString(undefined, { month: "short", year: "numeric" }).toUpperCase();
      const g = out[out.length - 1];
      if (g && g.label === label) g.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [reports, shown]);

  const issueCounts = data?.issues ?? [];
  const maxIssue = Math.max(1, ...issueCounts.map((x) => x.count));
  const bus = data?.bus;

  const viewReport = (r: KpiReportRow) => {
    if (r.job_id) router.push({ pathname: "/(app)/rm-manager/job/[id]", params: { id: String(r.job_id) } } as any);
  };

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <View style={s.topRow}>
        <View style={{ flex: 1 }} />
        <Pressable
          style={({ pressed }) => [s.exportBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.push({ pathname: "/performance/export", params: { kind: "bus", busId } } as any)}
        >
          <FontAwesome5 name="download" size={12} color={KPI_GREEN} />
          <Text style={s.exportText}>{t("performance.export")}</Text>
        </Pressable>
      </View>

      <View style={s.hero}>
        <View style={s.heroIcon}>
          <FontAwesome5 name="bus" size={18} color={KPI_GREEN} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.heroPlate}>{busId}</Text>
          <Text style={s.heroMeta}>
            {t("performance.fleetNoLine", {
              ev: bus?.bus_ev_no || "—",
              count: bus?.reports_all_time ?? 0,
            })}
          </Text>
        </View>
      </View>

      <PeriodBar
        period={period}
        onKind={(k) => {
          setKind(k);
          setOffset(0);
        }}
        onStep={(d) => setOffset((o) => Math.min(0, o + d))}
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} />
      ) : error ? (
        <Text style={s.error}>{error}</Text>
      ) : (
        <>
          <View style={s.statsRow}>
            {[
              [t("performance.jobs"), String(data?.jobs ?? 0)],
              [t("performance.downtime"), fmtDur(data?.downtime_ms)],
              [t("performance.avgTurnaround"), fmtDur(data?.avg_turnaround_ms)],
            ].map(([k, v]) => (
              <View key={k} style={s.stat}>
                <Text style={s.statLabel}>{k}</Text>
                <Text style={s.statValue}>{v}</Text>
              </View>
            ))}
          </View>

          <Card title={t("performance.issuesOnBus")} subtitle={t("performance.jobsThisPeriod", { count: data?.jobs ?? 0 })}>
            {issueCounts.length === 0 ? (
              <Text style={s.muted}>{t("performance.noJobs")}</Text>
            ) : (
              issueCounts.map((x) => (
                <BarRow key={x.issue_type} label={busSystemLabel(x.issue_type, t)} value={x.count} max={maxIssue} wide />
              ))
            )}
          </Card>

          <Text style={s.h2}>{t("performance.reportHistory")}</Text>
          <Text style={s.muted}>{t("performance.reportHistorySub")}</Text>

          <View style={s.searchWrap}>
            <FontAwesome5 name="search" size={13} color="#9CA3AF" />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={t("performance.searchReports")}
              placeholderTextColor="#9CA3AF"
              style={s.search}
              autoCorrect={false}
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            <Chip label={`${t("performance.all")} ${data?.reports.length ?? 0}`} active={issue === "all"} onPress={() => setIssue("all")} />
            {issueCounts.map((x) => (
              <Chip
                key={x.issue_type}
                label={`${busSystemLabel(x.issue_type, t)} ${x.count}`}
                active={issue === x.issue_type}
                onPress={() => setIssue(x.issue_type)}
              />
            ))}
          </ScrollView>
          <View style={s.chips}>
            <Text style={s.muted}>{t("performance.statusLabel")}</Text>
            {(["all", "open", "closed"] as StatusFilter[]).map((k) => (
              <Chip key={k} label={t(`performance.status_${k}`)} active={status === k} onPress={() => setStatus(k)} />
            ))}
          </View>

          {groups.length === 0 ? (
            <Text style={s.muted}>{t("performance.noReports")}</Text>
          ) : (
            groups.map((g) => (
              <View key={g.label} style={{ gap: 10 }}>
                <Text style={s.month}>{g.label}</Text>
                {g.rows.map((r) => {
                  const closed = r.status === "closed";
                  return (
                    <View key={r.report_id} style={s.reportCard}>
                      <View style={s.reportHead}>
                        <Text style={s.reportTitle}>
                          {r.report_type === "job_order" ? reportTypeTitleLabel("job_order", t) : t("performance.reportN")} #{r.report_id}
                          <Text style={s.reportDate}>
                            {"  ·  "}
                            {new Date(r.reported_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                          </Text>
                        </Text>
                        <View style={[s.statusPill, closed ? s.statusClosed : s.statusOpen]}>
                          <Text style={[s.statusText, closed ? s.statusClosedText : s.statusOpenText]}>
                            {t(`performance.status_${closed ? "closed" : "open"}`)}
                          </Text>
                        </View>
                      </View>
                      <Text style={s.reportIssue}>
                        <Text style={{ fontWeight: "800" }}>{t("reportCard.issue")} </Text>
                        {r.issue ?? "—"}
                      </Text>
                      <Text style={s.reportMeta}>
                        {busSystemLabel(r.issue_type, t)}
                        {r.turnaround_ms != null ? ` · ${t("performance.turnaroundValue", { value: fmtDur(r.turnaround_ms) })}` : ""}
                      </Text>
                      <View style={s.reportBtns}>
                        <Pressable style={s.btnOutline} onPress={() => viewReport(r)} disabled={!r.job_id}>
                          <Text style={s.btnOutlineText}>{t("performance.viewReport")}</Text>
                        </Pressable>
                        {closed && r.job_id != null && (
                          <Pressable
                            style={[s.btnPdf, pdf.busy && { opacity: 0.6 }]}
                            disabled={pdf.busy}
                            onPress={() => pdf.run(() => api.jobReportPdf(r.job_id!))}
                          >
                            <FontAwesome5 name="download" size={11} color={KPI_GREEN} />
                            <Text style={s.btnPdfText}>{pdf.busy ? "…" : "PDF"}</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))
          )}

          {reports.length > shown && (
            <Pressable onPress={() => setShown((n) => n + PAGE)} style={s.more}>
              <Text style={s.moreText}>{t("performance.showMore", { count: Math.min(PAGE, reports.length - shown) })}</Text>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F3F4F6" },
  content: { padding: 16, gap: 12, paddingBottom: 40, width: "100%", maxWidth: 760, alignSelf: "center" },
  topRow: { flexDirection: "row", alignItems: "center" },
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
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#F0FDF4",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  heroIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  heroPlate: { fontSize: 22, fontWeight: "800", color: "#111827" },
  heroMeta: { fontSize: 13, color: "#4B5563", marginTop: 2 },
  error: { color: "#B91C1C" },
  statsRow: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 12 },
  statLabel: { fontSize: 12, color: "#6B7280" },
  statValue: { fontSize: 20, fontWeight: "800", color: "#111827", marginTop: 4 },
  muted: { fontSize: 13, color: "#6B7280" },
  h2: { fontSize: 17, fontWeight: "800", color: "#111827", marginTop: 6 },
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
  chips: { flexDirection: "row", alignItems: "center", gap: 8 },
  month: { fontSize: 12, fontWeight: "800", color: "#6B7280", letterSpacing: 1, marginTop: 6 },
  reportCard: { backgroundColor: "#fff", borderRadius: 16, padding: 14 },
  reportHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  reportTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: "#111827" },
  reportDate: { fontWeight: "500", color: "#4B5563" },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusClosed: { backgroundColor: "#DCFCE7" },
  statusOpen: { backgroundColor: "#DBEAFE" },
  statusText: { fontSize: 12, fontWeight: "800" },
  statusClosedText: { color: "#15803D" },
  statusOpenText: { color: "#1D4ED8" },
  reportIssue: { fontSize: 14, color: "#111827", marginTop: 8 },
  reportMeta: { fontSize: 12, color: "#6B7280", marginTop: 4 },
  reportBtns: { flexDirection: "row", gap: 10, marginTop: 12 },
  btnOutline: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  btnOutlineText: { fontSize: 14, fontWeight: "700", color: "#111827" },
  btnPdf: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#F0FDF4",
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPdfText: { fontSize: 14, fontWeight: "800", color: KPI_GREEN },
  more: { alignItems: "center", paddingVertical: 12 },
  moreText: { fontSize: 14, fontWeight: "700", color: KPI_GREEN },
});
