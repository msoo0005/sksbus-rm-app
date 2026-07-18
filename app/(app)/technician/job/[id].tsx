import { FontAwesome5 } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ReportMedia } from "../../../api/client";
import { api } from "../../../api/client";
import type { LocalMedia } from "../../../components/ImagePicker";
import ImagePickerField from "../../../components/ImagePicker";
import ImageViewerOverlay from "../../../components/ImageViewerOverlay";
import type { StatusType } from "../../../components/StatusBadge";
import StatusBadge from "../../../components/StatusBadge";
import { openDirections } from "../../../utils/directions";

type TaskStatus = "pending" | "in_progress" | "blocked" | "done";

type JobListItem = {
  job_id: number;
  job_desc: string | null;
  job_status: string;
  technician_user_id: number | null;
  job_created_at?: string | null;
  job_odometer?: number | null;
  report_id: number | null;
  report_type: string | null;
  report_priority: string | null;
  bus_id: string | null;
  reporter_name: string | null;
};

type ReportDto = {
  report_id: number;
  report_type: string;
  report_desc?: string | null;
  report_location?: string | null;
  report_lat?: number | null;
  report_lng?: number | null;
  report_priority?: string | null;
  bus_id?: string | null;
  report_uploaded_at?: string | null;
  reporter_name?: string | null;
  reporter_email?: string | null;
};

type JobTask = {
  task_id: number;
  job_id: number;
  task_name: string;
  task_desc: string | null;
  task_status: TaskStatus;
  task_order: number;
  completed_at?: string | null;
};

type PartRow = {
  part_id: number;
  part_name: string;
  part_code: string;
  part_cost: number | null;
  part_stock: number | null;
};

function toLower(x: unknown) {
  return String(x ?? "").trim().toLowerCase();
}
function normaliseReportType(x: unknown): StatusType {
  const v = toLower(x);
  if (v === "repair" || v === "problem" || v === "accident") return v;
  return "repair";
}
function normalisePriority(x: unknown): StatusType {
  const v = toLower(x);
  if (v === "low" || v === "medium" || v === "high" || v === "critical") return v;
  return "medium";
}
const isNonEmptyString = (x: unknown): x is string =>
  typeof x === "string" && x.trim().length > 0;
function guessMimeFromUrl(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}
function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value || "—"}</Text>
    </View>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.cardIconBox}>
          <FontAwesome5 name={icon as any} size={13} color="#6B7280" />
        </View>
        <Text style={s.cardTitle}>{title}</Text>
      </View>
      <View style={s.cardDivider} />
      {children}
    </View>
  );
}

// ── Main screen ─────────────────────────────────────────────────────────────

export default function TechnicianJobDetailsScreen() {
  const router = useRouter();
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: "view" | "edit" }>();
  const canEdit = mode !== "view";
  const jobId = useMemo(() => Number(id), [id]);

  const scrollRef = useRef<ScrollView>(null);
  const odometerInputRef = useRef<TextInput>(null);

  const [loading, setLoading] = useState(false);
  const [jobSummary, setJobSummary] = useState<JobListItem | null>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [tasks, setTasks] = useState<JobTask[]>([]);

  const [issue, setIssue] = useState("");
  const [solution, setSolution] = useState("");
  const [savingTask, setSavingTask] = useState(false);

  const [parts, setParts] = useState<PartRow[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);
  const [selectedParts, setSelectedParts] = useState<Record<number, number>>({});
  const [partsOpen, setPartsOpen] = useState(false);
  const [partsSearch, setPartsSearch] = useState("");

  const [odometerInput, setOdometerInput] = useState("");
  const [savingOdometer, setSavingOdometer] = useState(false);

  const [afterMedia, setAfterMedia] = useState<LocalMedia[]>([]);
  const [reportPhotoUrls, setReportPhotoUrls] = useState<string[]>([]);
  const [loadingReportPhotos, setLoadingReportPhotos] = useState(false);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [completing, setCompleting] = useState(false);

  const viewerUrls = useMemo(() => reportPhotoUrls.map((u) => ({ url: u })), [reportPhotoUrls]);

  const hasOdometer = useMemo(() => {
    const v = jobSummary?.job_odometer;
    return typeof v === "number" && Number.isFinite(v);
  }, [jobSummary?.job_odometer]);

  const jobLocked = canEdit && !hasOdometer;

  const scrollToOdometerAndFocus = () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    setTimeout(() => odometerInputRef.current?.focus(), 300);
  };

  const handleOdometerRequired = () => {
    Alert.alert(
      "Odometer required",
      "Please enter the initial odometer reading before adding completed tasks, uploading after photos, or completing the job.",
    );
    scrollToOdometerAndFocus();
  };

  const handleApiError = (e: unknown, fallbackTitle = "Error") => {
    const err = e as { code?: string; message?: string };
    if (err?.code === "ODOMETER_REQUIRED") { handleOdometerRequired(); return; }
    if (err?.code === "JOB_NOT_ACCEPTED") {
      Alert.alert("Job not accepted", "Please accept/claim the job before updating it.");
      return;
    }
    Alert.alert(fallbackTitle, err?.message ?? "Unknown error");
  };

  const openViewer = (index: number) => {
    if (!reportPhotoUrls.length) return;
    setViewerIndex(Math.min(Math.max(index, 0), reportPhotoUrls.length - 1));
    setViewerVisible(true);
  };

  const loadReportPhotos = async (reportId: number) => {
    if (!Number.isFinite(reportId) || reportId <= 0) return;
    setLoadingReportPhotos(true);
    try {
      const media = (await api.listReportMedia(reportId)) as ReportMedia[];
      const urls = (Array.isArray(media) ? media : []).map((m) => m?.viewUrl ?? null).filter(isNonEmptyString);
      setReportPhotoUrls(Array.from(new Set(urls)));
    } catch { setReportPhotoUrls([]); }
    finally { setLoadingReportPhotos(false); }
  };

  const loadParts = async () => {
    setLoadingParts(true);
    try {
      const rows = (await api.parts({ limit: 200 })) as PartRow[];
      setParts(Array.isArray(rows) ? rows : []);
    } catch (e: unknown) { handleApiError(e, "Failed to load parts"); setParts([]); }
    finally { setLoadingParts(false); }
  };

  const fetchAll = async () => {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    setLoading(true);
    try {
      const allJobs = (await api.listJobs()) as JobListItem[];
      const found = (Array.isArray(allJobs) ? allJobs : []).find((j) => Number(j.job_id) === jobId);
      setJobSummary(found ?? null);
      const od = found?.job_odometer;
      if (od != null && Number.isFinite(Number(od))) setOdometerInput(String(od));
      else setOdometerInput("");
      if (found?.report_id) {
        const r = (await api.getReport(found.report_id)) as ReportDto;
        setReport(r ?? null);
        setReportPhotoUrls([]);
        loadReportPhotos(found.report_id);
      } else { setReport(null); setReportPhotoUrls([]); }
      const t = (await api.listJobTasks(jobId)) as JobTask[];
      setTasks(Array.isArray(t) ? t : []);
    } catch (e: unknown) { handleApiError(e, "Failed to load job"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); loadParts(); }, [jobId]);

  const saveOdometer = async () => {
    if (!canEdit) return;
    const raw = odometerInput.trim();
    if (!raw) { Alert.alert("Odometer required", "Please enter the initial odometer reading."); scrollToOdometerAndFocus(); return; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) { Alert.alert("Invalid odometer", "Please enter a whole number (e.g., 123456)."); scrollToOdometerAndFocus(); return; }
    setSavingOdometer(true);
    try {
      await api.patchJob(jobId, { job_odometer: n });
      setJobSummary((prev) => (prev ? { ...prev, job_odometer: n } : prev));
      Alert.alert("Saved", "Initial odometer reading has been saved.");
    } catch (e: unknown) { handleApiError(e, "Failed to save odometer"); }
    finally { setSavingOdometer(false); }
  };

  const partsById = useMemo(() => { const m = new Map<number, PartRow>(); for (const p of parts) m.set(p.part_id, p); return m; }, [parts]);

  const filteredDropdownParts = useMemo(() => {
    const q = partsSearch.trim().toLowerCase();
    const list = Array.isArray(parts) ? parts : [];
    if (!q) return list.slice(0, 50);
    return list.filter((p) => String(p.part_name ?? "").toLowerCase().includes(q) || String(p.part_code ?? "").toLowerCase().includes(q)).slice(0, 50);
  }, [parts, partsSearch]);

  const selectedPartIds = useMemo(() => Object.keys(selectedParts).map(Number).filter((pid) => Number.isFinite(pid) && (selectedParts[pid] ?? 0) > 0), [selectedParts]);

  const addOrIncPart = (partId: number) => setSelectedParts((prev) => ({ ...prev, [partId]: (prev[partId] ?? 0) + 1 }));
  const changeQty = (partId: number, delta: number) => setSelectedParts((prev) => { const cur = prev[partId] ?? 0; const next = cur + delta; const copy = { ...prev }; if (next <= 0) delete copy[partId]; else copy[partId] = next; return copy; });
  const removePart = (partId: number) => setSelectedParts((prev) => { const next = { ...prev }; delete next[partId]; return next; });

  const createCompletedTask = async () => {
    if (!canEdit) return;
    if (jobLocked) { handleOdometerRequired(); return; }
    const issueText = issue.trim();
    if (!issueText) { Alert.alert("Task issue required", "Please enter the task issue/problem."); return; }
    setSavingTask(true);
    try {
      const nextOrder = tasks.length ? Math.max(...tasks.map((x) => x.task_order ?? 0)) + 1 : 1;
      const created = await api.createJobTask(jobId, { task_name: issueText, task_desc: solution.trim() || null, task_status: "done", task_order: nextOrder });
      const taskId = Number((created as { task_id?: number }).task_id);
      const partEntries = Object.entries(selectedParts).map(([k, qty]) => ({ part_id: Number(k), qty: Number(qty) })).filter((x) => Number.isFinite(x.part_id) && x.part_id > 0 && x.qty > 0);
      if (taskId && partEntries.length) { for (const p of partEntries) await api.addTaskPart(taskId, { part_id: p.part_id, qty: p.qty }); }
      setIssue(""); setSolution(""); setSelectedParts({}); setPartsSearch(""); setPartsOpen(false);
      await fetchAll();
    } catch (e: unknown) { handleApiError(e, "Failed to add completed task"); }
    finally { setSavingTask(false); }
  };

  const completedTasks = useMemo(() => tasks.filter((t) => t.task_status === "done").slice().sort((a, b) => { const ad = a.completed_at ? new Date(a.completed_at).getTime() : 0; const bd = b.completed_at ? new Date(b.completed_at).getTime() : 0; return bd !== ad ? bd - ad : (b.task_order ?? 0) - (a.task_order ?? 0); }), [tasks]);

  const uploadAfterPhotos = async (jId: number, media: LocalMedia[]) => {
    for (const m of media) {
      const presign = await api.presignJobMedia(jId, m.mime_type);
      const blob = await (await fetch(m.localUri)).blob();
      const put = await fetch(presign.uploadUrl, { method: "PUT", headers: { "Content-Type": m.mime_type }, body: blob });
      if (!put.ok) throw new Error(`Photo upload failed (${put.status})`);
      await api.confirmJobMedia(jId, { s3_key: presign.s3_key, mime_type: m.mime_type, size_bytes: blob.size });
    }
  };

  const doCompleteJob = async () => {
    const reportId = jobSummary?.report_id ?? null;
    setCompleting(true);
    try {
      await uploadAfterPhotos(jobId, afterMedia);
      await api.updateJobStatus(jobId, { to_status: "closed" });
      if (Number.isFinite(reportId) && (reportId as number) > 0) {
        await api.updateReportStatus(reportId as number, { report_status: "closed", report_review_action: null, report_review_reason: null, report_review_by: null, report_review_at: new Date().toISOString() });
      }
      Alert.alert("Job completed", reportId ? "Job and report have been closed." : "Job has been closed.");
      router.back();
    } catch (e: unknown) { handleApiError(e, "Failed to complete job"); }
    finally { setCompleting(false); }
  };

  const completeJob = () => {
    if (!canEdit) return;
    if (jobLocked) { handleOdometerRequired(); return; }
    if (completedTasks.length === 0) { Alert.alert("Add a completed task first", "Please add at least 1 completed task before completing the job."); return; }
    if (afterMedia.length === 0) { Alert.alert("After photo required", "Please add at least 1 after photo before completing the job."); return; }
    Alert.alert("Complete Job", "Are you sure you want to mark this job as complete? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Complete Job", style: "default", onPress: doCompleteJob },
    ]);
  };

  const reportPhotoMedia: LocalMedia[] = useMemo(() => reportPhotoUrls.map((u) => ({ localUri: u, mime_type: guessMimeFromUrl(u) })), [reportPhotoUrls]);

  const onAfterPhotosChange = (next: LocalMedia[]) => {
    if (jobLocked && next.length > afterMedia.length) { handleOdometerRequired(); return; }
    setAfterMedia(next);
  };

  const hasLocation = report?.report_lat != null && report?.report_lng != null;

  return (
    <>
      <Stack.Screen options={{ title: "Job Details" }} />

      <KeyboardAvoidingView style={s.page} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView ref={scrollRef} style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>

        {/* ── Hero ── */}
        <View style={s.hero}>
          <View style={s.heroTop}>
            <View style={s.heroLeft}>
              <Text style={s.heroEyebrow}>JOB</Text>
              <Text style={s.heroId}>#{jobId}</Text>
              {loading && <Text style={s.loadingText}>Loading…</Text>}
            </View>
            <View style={s.badgeStack}>
              <StatusBadge type={normaliseReportType(jobSummary?.report_type)} />
              <StatusBadge type={normalisePriority(jobSummary?.report_priority)} />
            </View>
          </View>

          {(jobSummary?.bus_id || report?.report_location) && (
            <View style={s.heroSubRow}>
              {jobSummary?.bus_id && (
                <View style={s.chip}>
                  <FontAwesome5 name="bus" size={11} color="#6B7280" />
                  <Text style={s.chipText}>{jobSummary.bus_id}</Text>
                </View>
              )}
              {report?.report_location && (
                <Pressable
                  style={({ pressed }) => [s.chip, hasLocation && s.chipTappable, pressed && { opacity: 0.6 }]}
                  onPress={() => hasLocation && openDirections(report.report_lat!, report.report_lng!)}
                  disabled={!hasLocation}
                >
                  <FontAwesome5 name="map-marker-alt" size={11} color={hasLocation ? "#2563EB" : "#6B7280"} />
                  <Text style={[s.chipText, hasLocation && { color: "#2563EB" }]}>{report.report_location}</Text>
                  {hasLocation && <FontAwesome5 name="directions" size={11} color="#2563EB" />}
                </Pressable>
              )}
            </View>
          )}

          {!canEdit && (
            <View style={s.hintBanner}>
              <FontAwesome5 name="eye" size={12} color="#2563EB" />
              <Text style={s.hintText}>View only — accept the job to update tasks.</Text>
            </View>
          )}
        </View>

        {/* ── Odometer gate ── */}
        {canEdit && (
          <View style={[s.card, jobLocked && s.cardWarn]}>
            <View style={s.cardHeader}>
              <View style={[s.cardIconBox, jobLocked && { backgroundColor: "#FEE2E2" }]}>
                <FontAwesome5 name="tachometer-alt" size={13} color={jobLocked ? "#DC2626" : "#6B7280"} />
              </View>
              <Text style={[s.cardTitle, jobLocked && { color: "#DC2626" }]}>Initial Odometer</Text>
            </View>
            <View style={s.cardDivider} />

            {hasOdometer ? (
              <Field label="Recorded Reading" value={String(jobSummary?.job_odometer)} />
            ) : (
              <>
                <Text style={s.mutedText}>Enter the current odometer reading to unlock job updates.</Text>
                <View style={[s.inputWrap, { marginTop: 12 }]}>
                  <TextInput
                    ref={odometerInputRef}
                    value={odometerInput}
                    onChangeText={setOdometerInput}
                    placeholder="e.g. 123456"
                    placeholderTextColor="#9CA3AF"
                    style={s.input}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    onSubmitEditing={saveOdometer}
                  />
                </View>
                <Pressable style={[s.btn, s.btnDark, { marginTop: 12 }, savingOdometer && { opacity: 0.7 }]} onPress={saveOdometer} disabled={savingOdometer}>
                  <Text style={s.btnText}>{savingOdometer ? "Saving…" : "Save Odometer"}</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* ── Initial Report ── */}
        <SectionCard title="Initial Report" icon="file-alt">
          <Field label="Report ID" value={jobSummary?.report_id != null ? `#${jobSummary.report_id}` : null} />
          <Field label="Reported By" value={jobSummary?.reporter_name ?? report?.reporter_name} />
          <Field label="Priority" value={jobSummary?.report_priority ?? report?.report_priority} />
          <Field label="Description" value={report?.report_desc ?? jobSummary?.job_desc} />

          {/* Report photos */}
          <View style={s.photoSection}>
            <View style={s.photoHeaderRow}>
              <Text style={s.photoSectionLabel}>PHOTOS</Text>
              <View style={s.countPill}>
                <Text style={s.countPillText}>{reportPhotoMedia.length} photo{reportPhotoMedia.length === 1 ? "" : "s"}</Text>
              </View>
            </View>
            {loadingReportPhotos ? (
              <Text style={s.mutedText}>Loading photos…</Text>
            ) : reportPhotoUrls.length === 0 ? (
              <Text style={s.mutedText}>No photos attached.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoStrip}>
                {reportPhotoUrls.map((uri, idx) => (
                  <Pressable key={`${uri}-${idx}`} onPress={() => openViewer(idx)} style={s.thumb}>
                    <Image source={{ uri }} style={s.thumbImg} />
                    <View style={s.thumbOverlay}>
                      <FontAwesome5 name="expand-alt" size={14} color="#fff" />
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </SectionCard>

        {/* ── Add Completed Task ── */}
        {canEdit && (
          <SectionCard title="Add Completed Task" icon="plus-circle">
            <Text style={s.inputLabel}>Task Issue</Text>
            <View style={s.inputWrap}>
              <TextInput value={issue} onChangeText={setIssue} placeholder="e.g. Aircon not cooling" placeholderTextColor="#9CA3AF" style={s.input} editable={!jobLocked} onFocus={() => jobLocked && handleOdometerRequired()} />
            </View>

            <Text style={[s.inputLabel, { marginTop: 12 }]}>Task Solution</Text>
            <View style={s.inputWrap}>
              <TextInput value={solution} onChangeText={setSolution} placeholder="What did you do? (optional)" placeholderTextColor="#9CA3AF" style={s.textarea} multiline editable={!jobLocked} onFocus={() => jobLocked && handleOdometerRequired()} />
            </View>

            <View style={[s.rowBetween, { marginTop: 14 }]}>
              <Text style={s.inputLabel}>Parts Used</Text>
              <View style={s.countPill}><Text style={s.countPillText}>{selectedPartIds.length} selected</Text></View>
            </View>

            <Pressable style={[s.dropdownTrigger, jobLocked && { opacity: 0.6 }]} onPress={() => { if (jobLocked) return handleOdometerRequired(); setPartsOpen((v) => !v); }}>
              <Text style={s.dropdownTriggerText}>{loadingParts ? "Loading parts…" : partsOpen ? "Close parts list" : "Select parts (search)"}</Text>
              <FontAwesome5 name={partsOpen ? "chevron-up" : "chevron-down"} size={12} color="#6B7280" />
            </Pressable>

            {partsOpen && (
              <View style={s.dropdownPanel}>
                <View style={s.inputWrap}>
                  <TextInput value={partsSearch} onChangeText={setPartsSearch} placeholder="Search by name or code…" placeholderTextColor="#9CA3AF" style={s.input} autoCorrect={false} editable={!jobLocked} />
                </View>
                <ScrollView style={{ maxHeight: 240, marginTop: 10 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {filteredDropdownParts.length === 0 ? (
                    <Text style={s.mutedText}>{loadingParts ? "Loading parts…" : "No matching parts."}</Text>
                  ) : filteredDropdownParts.map((p) => {
                    const qty = selectedParts[p.part_id] ?? 0;
                    return (
                      <Pressable key={p.part_id} style={[s.dropdownItem, qty > 0 && s.dropdownItemSelected]} onPress={() => { if (jobLocked) return handleOdometerRequired(); addOrIncPart(p.part_id); }}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.partName}>{p.part_name} <Text style={s.partCode}>({p.part_code})</Text></Text>
                          <Text style={s.partMeta}>Stock: {p.part_stock ?? "—"} · Cost: {p.part_cost ?? "—"}</Text>
                        </View>
                        {qty > 0 && <View style={s.qtyBadge}><Text style={s.qtyBadgeText}>×{qty}</Text></View>}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <View style={{ marginTop: 12, gap: 10 }}>
              {selectedPartIds.length === 0 ? (
                <Text style={s.mutedText}>No parts selected.</Text>
              ) : selectedPartIds.map((pid) => {
                const p = partsById.get(pid);
                const qty = selectedParts[pid] ?? 0;
                if (!p) return null;
                return (
                  <View key={pid} style={s.selectedCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.partName}>{p.part_name} <Text style={s.partCode}>({p.part_code})</Text></Text>
                      <Text style={s.partMeta}>Stock: {p.part_stock ?? "—"} · Cost: {p.part_cost ?? "—"}</Text>
                    </View>
                    <View style={s.qtyRow}>
                      <Pressable style={s.qtyBtn} onPress={() => jobLocked ? handleOdometerRequired() : changeQty(pid, -1)} disabled={jobLocked}>
                        <Text style={s.qtyBtnText}>−</Text>
                      </Pressable>
                      <Text style={s.qtyValue}>{qty}</Text>
                      <Pressable style={s.qtyBtn} onPress={() => jobLocked ? handleOdometerRequired() : changeQty(pid, +1)} disabled={jobLocked}>
                        <Text style={s.qtyBtnText}>+</Text>
                      </Pressable>
                      <Pressable style={s.removeBtn} onPress={() => jobLocked ? handleOdometerRequired() : removePart(pid)} disabled={jobLocked}>
                        <Text style={s.removeBtnText}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>

            <Pressable style={[s.btn, s.btnDark, { marginTop: 14 }, (jobLocked || savingTask) && { opacity: 0.6 }]} onPress={createCompletedTask} disabled={jobLocked || savingTask}>
              <Text style={s.btnText}>{savingTask ? "Saving…" : "Add Completed Task"}</Text>
            </Pressable>

            {jobLocked && <Text style={s.helperText}>Save the initial odometer reading to unlock job updates.</Text>}
          </SectionCard>
        )}

        {/* ── Completed Tasks ── */}
        <SectionCard title="Completed Tasks" icon="check-circle">
          {completedTasks.length === 0 ? (
            <Text style={s.mutedText}>No completed tasks yet.</Text>
          ) : completedTasks.map((t, i) => (
            <View key={t.task_id} style={[s.taskRow, i > 0 && s.taskRowBorder]}>
              <View style={s.taskCheck}>
                <FontAwesome5 name="check" size={11} color="#16A34A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.taskName}>{t.task_name}</Text>
                {!!t.task_desc && <Text style={s.taskDesc}>{t.task_desc}</Text>}
                <Text style={s.taskMeta}>Completed {formatDateTime(t.completed_at)}</Text>
              </View>
            </View>
          ))}
        </SectionCard>

        {/* ── After Photos ── */}
        {jobLocked && canEdit ? (
          <Pressable onPress={handleOdometerRequired}>
            <ImagePickerField title="After Photos" value={afterMedia} onChange={onAfterPhotosChange} captureLabel="Capture After Photo" uploadLabel="Upload After Photo" showUploadButton readOnly />
            <Text style={[s.helperText, { marginTop: 8 }]}>Save the initial odometer reading to upload after photos.</Text>
          </Pressable>
        ) : (
          <ImagePickerField title="After Photos" value={afterMedia} onChange={onAfterPhotosChange} captureLabel="Capture After Photo" uploadLabel="Upload After Photo" showUploadButton readOnly={!canEdit} />
        )}

        {/* ── Complete Job ── */}
        {canEdit && (
          <View style={s.actions}>
            <Pressable style={[s.btn, s.btnGreen, (jobLocked || completedTasks.length === 0 || afterMedia.length === 0 || completing) && { opacity: 0.6 }]} onPress={completeJob} disabled={jobLocked || completedTasks.length === 0 || afterMedia.length === 0 || completing}>
              <FontAwesome5 name="check" size={15} color="#fff" style={{ marginRight: 8 }} />
              <Text style={s.btnText}>{completing ? "Completing…" : "Complete Job"}</Text>
            </Pressable>
            {jobLocked ? (
              <Text style={s.helperText}>Save the initial odometer reading to complete the job.</Text>
            ) : completedTasks.length === 0 ? (
              <Text style={s.helperText}>Add at least 1 completed task to complete the job.</Text>
            ) : afterMedia.length === 0 ? (
              <Text style={s.helperText}>Add at least 1 after photo to complete the job.</Text>
            ) : null}
          </View>
        )}

      </ScrollView>
      </KeyboardAvoidingView>

      <ImageViewerOverlay visible={viewerVisible} imageUrls={viewerUrls} startIndex={viewerIndex} onClose={() => setViewerVisible(false)} />
    </>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, paddingTop: 14, gap: 14, paddingBottom: 40 },

  // Hero
  hero: { backgroundColor: "#fff", borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", padding: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroLeft: { flex: 1 },
  heroEyebrow: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", letterSpacing: 1.5, marginBottom: 2 },
  heroId: { fontSize: 36, fontWeight: "800", color: "#111827", letterSpacing: -1 },
  loadingText: { fontSize: 13, color: "#9CA3AF", marginTop: 4 },
  badgeStack: { flexDirection: "row", gap: 6, paddingTop: 4, flexWrap: "wrap", justifyContent: "flex-end" },
  heroSubRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F9FAFB", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#E5E7EB" },
  chipTappable: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  hintBanner: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 14, backgroundColor: "#EFF6FF", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  hintText: { fontSize: 13, fontWeight: "600", color: "#2563EB" },

  // Cards
  card: { backgroundColor: "#fff", borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", padding: 18, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  cardWarn: { borderColor: "#FECACA", backgroundColor: "#FEF2F2" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  cardIconBox: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 13, fontWeight: "700", color: "#374151" },
  cardDivider: { height: 1, backgroundColor: "#F3F4F6", marginBottom: 14 },

  // Fields
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3 },
  fieldValue: { fontSize: 15, fontWeight: "600", color: "#111827", lineHeight: 21 },

  mutedText: { fontSize: 14, color: "#9CA3AF", fontWeight: "500" },

  // Photos
  photoSection: { marginTop: 6 },
  photoHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  photoSectionLabel: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", letterSpacing: 1.2 },
  countPill: { backgroundColor: "#F3F4F6", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  countPillText: { fontSize: 12, fontWeight: "600", color: "#6B7280" },
  photoStrip: { gap: 10, paddingBottom: 2 },
  thumb: { width: 96, height: 96, borderRadius: 14, overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },
  thumbOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.2)", alignItems: "center", justifyContent: "center" },

  // Tasks
  taskRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12 },
  taskRowBorder: { borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  taskCheck: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", alignItems: "center", justifyContent: "center", marginTop: 1 },
  taskName: { fontSize: 14, fontWeight: "700", color: "#111827", marginBottom: 2 },
  taskDesc: { fontSize: 13, color: "#6B7280", marginBottom: 4 },
  taskMeta: { fontSize: 12, color: "#9CA3AF", fontWeight: "500" },

  // Buttons
  actions: { gap: 10, marginBottom: 8 },
  btn: { height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  btnDark: { backgroundColor: "#111827" },
  btnGreen: { backgroundColor: "#16A34A" },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  helperText: { color: "#9CA3AF", fontSize: 13, fontWeight: "500", textAlign: "center", marginTop: 6 },

  // Form inputs
  inputLabel: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
  inputWrap: { backgroundColor: "#F9FAFB", borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 14, paddingVertical: 10 },
  input: { fontSize: 15, color: "#111827" },
  textarea: { minHeight: 72, fontSize: 15, color: "#111827" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  // Parts dropdown
  dropdownTrigger: { marginTop: 8, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dropdownTriggerText: { fontSize: 14, fontWeight: "600", color: "#111827" },
  dropdownPanel: { marginTop: 10, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 14, padding: 12, backgroundColor: "#fff" },
  dropdownItem: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 8, backgroundColor: "#fff" },
  dropdownItemSelected: { borderColor: "#111827", backgroundColor: "#F9FAFB" },
  partName: { fontSize: 14, fontWeight: "700", color: "#111827" },
  partCode: { fontWeight: "600", color: "#6B7280" },
  partMeta: { marginTop: 4, fontSize: 12, fontWeight: "500", color: "#6B7280" },
  qtyBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "#111827" },
  qtyBadgeText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  selectedCard: { flexDirection: "row", gap: 12, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 14, padding: 14, backgroundColor: "#fff" },
  qtyRow: { flexDirection: "column", alignItems: "center", gap: 6 },
  qtyBtn: { width: 40, height: 34, borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center", backgroundColor: "#F9FAFB" },
  qtyBtnText: { fontSize: 18, fontWeight: "700", color: "#111827" },
  qtyValue: { minWidth: 32, textAlign: "center", fontWeight: "700", color: "#111827", fontSize: 15 },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "#FECACA", backgroundColor: "#FEF2F2" },
  removeBtnText: { fontSize: 12, fontWeight: "700", color: "#DC2626" },
});
