// Export reports: "Breakdowns by date range" (all or some buses, any dates)
// or "Report by bus" (one bus's full history). The PDF is made on the server
// and opened in the share sheet, so it can be saved, printed or sent.

import DateTimePicker from "@react-native-community/datetimepicker";
import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api, type ExportRequest } from "@/api/client";
import BusPickerField from "@/components/BusPickerField";
import { KPI_GREEN } from "@/components/kpi/KpiParts";
import { useBusDirectory } from "@/hooks/useBusDirectory";
import { usePdfDownload } from "@/hooks/usePdfDownload";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useI18n } from "@/i18n/i18n-ctx";
import { formatBusLabel } from "@/utils/busLabel";
import { periodFor } from "@/utils/kpiPeriod";

type Kind = "range" | "bus";
type BusPeriod = "month" | "year" | "all";

export default function ExportScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ kind?: Kind; busId?: string }>();
  const projectId = useProjectFilter();
  const pdf = usePdfDownload();
  const { buses } = useBusDirectory();

  const thisMonth = useMemo(() => periodFor("month", 0), []);
  const [kind, setKind] = useState<Kind>(params.kind === "bus" ? "bus" : "range");

  // Date range
  const [from, setFrom] = useState<Date>(thisMonth.from);
  const [to, setTo] = useState<Date>(new Date(thisMonth.to.getTime() - 86400000));
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [busIds, setBusIds] = useState<string[]>([]);
  const [busesOpen, setBusesOpen] = useState(false);
  const [status, setStatus] = useState<"all" | "open" | "closed">("all");

  // By bus
  const [busId, setBusId] = useState<string | null>(params.busId ? String(params.busId) : null);
  const [busPeriod, setBusPeriod] = useState<BusPeriod>("all");

  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  const request = (): ExportRequest | null => {
    if (kind === "range") {
      const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
      if (end <= start) return null;
      return {
        kind: "range",
        from: start.toISOString(),
        to: end.toISOString(),
        project_id: projectId,
        bus_ids: busIds,
        status,
      };
    }
    if (!busId) return null;
    const p = busPeriod === "all" ? null : periodFor(busPeriod, 0);
    return {
      kind: "bus",
      bus_id: busId,
      from: p ? p.from.toISOString() : null,
      to: p ? p.to.toISOString() : null,
      project_id: projectId,
    };
  };

  const req = request();

  // After the first call creates the export, later polls must not create
  // another one; this holds the polling function for the hook's retries.
  const pollRef = React.useRef<null | (() => ReturnType<typeof api.getExport>)>(null);

  const runExport = () => {
    if (!req) return;
    pollRef.current = null;
    pdf.run(async () => {
      if (pollRef.current) return pollRef.current();
      const created = await api.createExport(req);
      pollRef.current = () => api.getExport(created.export_id, created.filename);
      return pollRef.current();
    });
  };

  const contents =
    kind === "range"
      ? [
          [t("export.rangeItem1"), t("export.rangeItem1Sub")],
          [t("export.rangeItem2"), t("export.rangeItem2Sub")],
          [t("export.rangeItem3"), t("export.rangeItem3Sub")],
          [t("export.rangeItem4"), t("export.rangeItem4Sub")],
        ]
      : [
          [t("export.busItem1"), t("export.busItem1Sub")],
          [t("export.busItem2"), t("export.busItem2Sub")],
          [t("export.busItem3"), t("export.busItem3Sub")],
          [t("export.busItem4"), t("export.busItem4Sub")],
        ];

  const selectedBus = buses.find((b) => String(b.bus_id) === busId);

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <Text style={s.step}>{t("export.step1")}</Text>
      {(["range", "bus"] as Kind[]).map((k) => {
        const active = kind === k;
        return (
          <Pressable key={k} onPress={() => setKind(k)} style={[s.option, active && s.optionActive]}>
            <View style={s.optionIcon}>
              <FontAwesome5 name={k === "range" ? "clock" : "bus"} size={14} color={KPI_GREEN} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.optionTitle}>{t(k === "range" ? "export.rangeTitle" : "export.busTitle")}</Text>
              <Text style={s.optionSub}>{t(k === "range" ? "export.rangeSub" : "export.busSub")}</Text>
            </View>
            <View style={[s.radio, active && s.radioActive]}>{active && <View style={s.radioDot} />}</View>
          </Pressable>
        );
      })}

      <Text style={s.step}>{t("export.step2")}</Text>
      <View style={s.card}>
        {kind === "range" ? (
          <>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["from", "to"] as const).map((which) => (
                <View key={which} style={{ flex: 1 }}>
                  <Text style={s.label}>{t(which === "from" ? "export.from" : "export.to")}</Text>
                  <Pressable style={s.input} onPress={() => setPicking(which)}>
                    <Text style={s.inputText}>{fmt(which === "from" ? from : to)}</Text>
                    <FontAwesome5 name="calendar-alt" size={13} color="#6B7280" />
                  </Pressable>
                </View>
              ))}
            </View>

            <Text style={s.label}>{t("export.buses")}</Text>
            <Pressable style={s.input} onPress={() => setBusesOpen(true)}>
              <Text style={s.inputText} numberOfLines={1}>
                {busIds.length === 0
                  ? t("export.allBuses", { count: buses.length })
                  : busIds.length === 1
                    ? formatBusLabel(busIds[0], buses.find((b) => String(b.bus_id) === busIds[0])?.bus_ev_no)
                    : t("export.nBuses", { count: busIds.length })}
              </Text>
              <FontAwesome5 name="chevron-down" size={12} color="#6B7280" />
            </Pressable>

            <Text style={s.label}>{t("export.status")}</Text>
            <View style={s.segment}>
              {(["all", "open", "closed"] as const).map((k) => (
                <Pressable key={k} onPress={() => setStatus(k)} style={[s.segItem, status === k && s.segActive]}>
                  <Text style={[s.segText, status === k && s.segTextActive]}>{t(`performance.status_${k}`)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={s.label}>{t("export.bus")}</Text>
            <BusPickerField value={busId} onChange={(id) => setBusId(id)} accent={KPI_GREEN} />
            <Text style={s.label}>{t("export.period")}</Text>
            <View style={s.segment}>
              {(["month", "year", "all"] as BusPeriod[]).map((k) => (
                <Pressable key={k} onPress={() => setBusPeriod(k)} style={[s.segItem, busPeriod === k && s.segActive]}>
                  <Text style={[s.segText, busPeriod === k && s.segTextActive]}>{t(`export.period_${k}`)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>

      <Text style={s.step}>{t("export.step3")}</Text>
      <View style={s.contents}>
        <View style={s.contentsHead}>
          <FontAwesome5 name="file-alt" size={13} color={KPI_GREEN} />
          <Text style={s.contentsTitle} numberOfLines={2}>
            {kind === "range"
              ? t("export.rangeHeading", { from: fmt(from), to: fmt(to) })
              : t("export.busHeading", {
                  bus: busId ? formatBusLabel(busId, selectedBus?.bus_ev_no) : "—",
                  period: t(`export.period_${busPeriod}`),
                })}
          </Text>
        </View>
        {contents.map(([title, sub], i) => (
          <View key={i} style={s.contentRow}>
            <View style={s.contentNum}>
              <Text style={s.contentNumText}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.contentTitle}>{title}</Text>
              <Text style={s.contentSub}>{sub}</Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        style={[s.exportBtn, (!req || pdf.busy) && { opacity: 0.6 }]}
        onPress={runExport}
        disabled={!req || pdf.busy}
      >
        <FontAwesome5 name="download" size={14} color="#fff" />
        <Text style={s.exportText}>{pdf.busy ? t("pdf.preparing") : t("export.exportPdf")}</Text>
      </Pressable>
      <Text style={s.footnote}>{t("export.footnote")}</Text>

      {/* Date picker: inline sheet on iOS, the system dialog on Android */}
      {picking && Platform.OS === "android" && (
        <DateTimePicker
          value={picking === "from" ? from : to}
          mode="date"
          maximumDate={new Date()}
          onChange={(_, d) => {
            const which = picking;
            setPicking(null);
            if (d && which === "from") setFrom(d);
            else if (d) setTo(d);
          }}
        />
      )}
      {Platform.OS === "ios" && (
        <Modal visible={!!picking} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
          <Pressable style={s.backdrop} onPress={() => setPicking(null)}>
            <Pressable style={s.sheet} onPress={() => {}}>
              {picking && (
                <DateTimePicker
                  value={picking === "from" ? from : to}
                  mode="date"
                  display="inline"
                  maximumDate={new Date()}
                  onChange={(_, d) => {
                    if (!d) return;
                    if (picking === "from") setFrom(d);
                    else setTo(d);
                  }}
                />
              )}
              <Pressable style={s.done} onPress={() => setPicking(null)}>
                <Text style={s.doneText}>{t("reportForm.done")}</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Bus multi-select */}
      <Modal visible={busesOpen} animationType="slide" onRequestClose={() => setBusesOpen(false)}>
        <View style={s.busSheet}>
          <View style={s.busHead}>
            <Text style={s.busTitle}>{t("export.buses")}</Text>
            <Pressable onPress={() => setBusesOpen(false)} style={s.doneSmall}>
              <Text style={s.doneText}>{t("reportForm.done")}</Text>
            </Pressable>
          </View>
          <ScrollView>
            <Pressable style={s.busRow} onPress={() => setBusIds([])}>
              <Text style={s.busRowText}>{t("export.allBuses", { count: buses.length })}</Text>
              {busIds.length === 0 && <FontAwesome5 name="check" size={14} color={KPI_GREEN} />}
            </Pressable>
            {[...buses]
              .sort((a, b) => String(a.bus_id).localeCompare(String(b.bus_id)))
              .map((b) => {
                const id = String(b.bus_id);
                const on = busIds.includes(id);
                return (
                  <Pressable
                    key={id}
                    style={s.busRow}
                    onPress={() => setBusIds((prev) => (on ? prev.filter((x) => x !== id) : [...prev, id]))}
                  >
                    <Text style={s.busRowText}>{formatBusLabel(id, b.bus_ev_no)}</Text>
                    {on && <FontAwesome5 name="check" size={14} color={KPI_GREEN} />}
                  </Pressable>
                );
              })}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F3F4F6" },
  content: { padding: 16, gap: 10, paddingBottom: 48, width: "100%", maxWidth: 640, alignSelf: "center" },
  step: { fontSize: 12, fontWeight: "800", color: "#6B7280", letterSpacing: 1.2, marginTop: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  optionActive: { borderColor: KPI_GREEN, backgroundColor: "#F0FDF4" },
  optionIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#ECFDF3", alignItems: "center", justifyContent: "center" },
  optionTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  optionSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  radioActive: { borderColor: KPI_GREEN },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: KPI_GREEN },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 14 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginTop: 12, marginBottom: 6 },
  input: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputText: { fontSize: 15, color: "#111827", flex: 1 },
  segment: { flexDirection: "row", backgroundColor: "#F3F4F6", borderRadius: 12, padding: 3 },
  segItem: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 9 },
  segActive: { backgroundColor: "#fff" },
  segText: { fontSize: 14, color: "#6B7280", fontWeight: "600" },
  segTextActive: { color: "#111827", fontWeight: "800" },
  contents: { borderWidth: 1, borderStyle: "dashed", borderColor: "#BBF7D0", borderRadius: 16, padding: 14, gap: 4 },
  contentsHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  contentsTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: "#111827" },
  contentRow: { flexDirection: "row", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  contentNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center" },
  contentNumText: { fontSize: 11, fontWeight: "800", color: KPI_GREEN },
  contentTitle: { fontSize: 14, fontWeight: "700", color: "#111827" },
  contentSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  exportBtn: {
    marginTop: 12,
    height: 54,
    borderRadius: 16,
    backgroundColor: KPI_GREEN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  exportText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  footnote: { textAlign: "center", fontSize: 12, color: "#6B7280" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32 },
  done: { alignSelf: "flex-end", marginTop: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: KPI_GREEN },
  doneSmall: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: KPI_GREEN },
  doneText: { color: "#fff", fontWeight: "800" },
  busSheet: { flex: 1, backgroundColor: "#fff", paddingTop: 56, paddingHorizontal: 16 },
  busHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  busTitle: { fontSize: 20, fontWeight: "800", color: "#111827" },
  busRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  busRowText: { fontSize: 15, fontWeight: "700", color: "#111827" },
});
