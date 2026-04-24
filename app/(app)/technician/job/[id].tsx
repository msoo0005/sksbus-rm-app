// app/(app)/technician/job/[id].tsx
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
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
  return String(x ?? "")
    .trim()
    .toLowerCase();
}

function normaliseReportType(x: unknown): StatusType {
  const v = toLower(x);
  if (v === "repair" || v === "problem" || v === "accident") return v;
  return "repair";
}

function normalisePriority(x: unknown): StatusType {
  const v = toLower(x);
  if (v === "low" || v === "medium" || v === "high" || v === "critical")
    return v;
  return "medium";
}

const isNonEmptyString = (x: unknown): x is string =>
  typeof x === "string" && x.trim().length > 0;

function guessMimeFromUrl(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

export default function TechnicianJobDetailsScreen() {
  const router = useRouter();

  const { id, mode } = useLocalSearchParams<{
    id: string;
    mode?: "view" | "edit";
  }>();

  const canEdit = mode !== "view";
  const jobId = useMemo(() => Number(id), [id]);

  const scrollRef = useRef<ScrollView>(null);
  const odometerInputRef = useRef<TextInput>(null);

  const [loading, setLoading] = useState(false);

  const [jobSummary, setJobSummary] = useState<JobListItem | null>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [tasks, setTasks] = useState<JobTask[]>([]);

  // Completed task form
  const [issue, setIssue] = useState("");
  const [solution, setSolution] = useState("");
  const [savingTask, setSavingTask] = useState(false);

  // Parts catalog
  const [parts, setParts] = useState<PartRow[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);

  // Selected parts => qty
  const [selectedParts, setSelectedParts] = useState<Record<number, number>>(
    {},
  );

  // Dropdown state
  const [partsOpen, setPartsOpen] = useState(false);
  const [partsSearch, setPartsSearch] = useState("");

  // Initial odometer gate
  const [odometerInput, setOdometerInput] = useState("");
  const [savingOdometer, setSavingOdometer] = useState(false);

  // After photos (local)
  const [afterMedia, setAfterMedia] = useState<LocalMedia[]>([]);

  // Report photos (remote)
  const [reportPhotoUrls, setReportPhotoUrls] = useState<string[]>([]);
  const [loadingReportPhotos, setLoadingReportPhotos] = useState(false);

  // viewer overlay state
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const viewerUrls = useMemo(
    () => reportPhotoUrls.map((u) => ({ url: u })),
    [reportPhotoUrls],
  );

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
    if (err?.code === "ODOMETER_REQUIRED") {
      handleOdometerRequired();
      return;
    }
    if (err?.code === "JOB_NOT_ACCEPTED") {
      Alert.alert(
        "Job not accepted",
        "Please accept/claim the job before updating it.",
      );
      return;
    }
    Alert.alert(fallbackTitle, err?.message ?? "Unknown error");
  };

  const openViewer = (index: number) => {
    if (!reportPhotoUrls.length) return;
    const safe = Math.min(Math.max(index, 0), reportPhotoUrls.length - 1);
    setViewerIndex(safe);
    setViewerVisible(true);
  };

  const loadReportPhotos = async (reportId: number) => {
    if (!Number.isFinite(reportId) || reportId <= 0) return;

    setLoadingReportPhotos(true);
    try {
      const media = (await api.listReportMedia(reportId)) as ReportMedia[];
      const urls = (Array.isArray(media) ? media : [])
        .map((m) => m?.viewUrl ?? null)
        .filter(isNonEmptyString);
      setReportPhotoUrls(Array.from(new Set(urls)));
    } catch {
      setReportPhotoUrls([]);
    } finally {
      setLoadingReportPhotos(false);
    }
  };

  const loadParts = async () => {
    setLoadingParts(true);
    try {
      const rows = (await api.parts({ limit: 200 })) as PartRow[];
      setParts(Array.isArray(rows) ? rows : []);
    } catch (e: unknown) {
      handleApiError(e, "Failed to load parts");
      setParts([]);
    } finally {
      setLoadingParts(false);
    }
  };

  const fetchAll = async () => {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    setLoading(true);
    try {
      const allJobs = (await api.listJobs()) as JobListItem[];
      const found = (Array.isArray(allJobs) ? allJobs : []).find(
        (j) => Number(j.job_id) === jobId,
      );
      setJobSummary(found ?? null);

      const od = found?.job_odometer;
      if (od != null && Number.isFinite(Number(od)))
        setOdometerInput(String(od));
      else setOdometerInput("");

      if (found?.report_id) {
        const r = (await api.getReport(found.report_id)) as ReportDto;
        setReport(r ?? null);
        setReportPhotoUrls([]);
        loadReportPhotos(found.report_id);
      } else {
        setReport(null);
        setReportPhotoUrls([]);
      }

      const t = (await api.listJobTasks(jobId)) as JobTask[];
      setTasks(Array.isArray(t) ? t : []);
    } catch (e: unknown) {
      handleApiError(e, "Failed to load job");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    loadParts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const saveOdometer = async () => {
    if (!canEdit) return;

    const raw = odometerInput.trim();
    if (!raw) {
      Alert.alert(
        "Odometer required",
        "Please enter the initial odometer reading.",
      );
      scrollToOdometerAndFocus();
      return;
    }

    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      Alert.alert(
        "Invalid odometer",
        "Please enter a whole number (e.g., 123456).",
      );
      scrollToOdometerAndFocus();
      return;
    }

    setSavingOdometer(true);
    try {
      await api.patchJob(jobId, { job_odometer: n });

      setJobSummary((prev) => (prev ? { ...prev, job_odometer: n } : prev));
      Alert.alert("Saved", "Initial odometer reading has been saved.");
    } catch (e: unknown) {
      handleApiError(e, "Failed to save odometer");
    } finally {
      setSavingOdometer(false);
    }
  };

  // Maps / derived lists
  const partsById = useMemo(() => {
    const m = new Map<number, PartRow>();
    for (const p of parts) m.set(p.part_id, p);
    return m;
  }, [parts]);

  const filteredDropdownParts = useMemo(() => {
    const q = partsSearch.trim().toLowerCase();
    const list = Array.isArray(parts) ? parts : [];
    if (!q) return list.slice(0, 50);

    return list
      .filter((p) => {
        const name = String(p.part_name ?? "").toLowerCase();
        const code = String(p.part_code ?? "").toLowerCase();
        return name.includes(q) || code.includes(q);
      })
      .slice(0, 50);
  }, [parts, partsSearch]);

  const selectedPartIds = useMemo(
    () =>
      Object.keys(selectedParts)
        .map((k) => Number(k))
        .filter((pid) => Number.isFinite(pid) && (selectedParts[pid] ?? 0) > 0),
    [selectedParts],
  );

  const addOrIncPart = (partId: number) => {
    setSelectedParts((prev) => ({
      ...prev,
      [partId]: (prev[partId] ?? 0) + 1,
    }));
  };

  const changeQty = (partId: number, delta: number) => {
    setSelectedParts((prev) => {
      const cur = prev[partId] ?? 0;
      const next = cur + delta;
      const copy: Record<number, number> = { ...prev };
      if (next <= 0) delete copy[partId];
      else copy[partId] = next;
      return copy;
    });
  };

  const removePart = (partId: number) => {
    setSelectedParts((prev) => {
      const next = { ...prev };
      delete next[partId];
      return next;
    });
  };

  const createCompletedTask = async () => {
    if (!canEdit) return;

    if (jobLocked) {
      handleOdometerRequired();
      return;
    }

    const issueText = issue.trim();
    if (!issueText) {
      Alert.alert(
        "Task issue required",
        "Please enter the task issue/problem.",
      );
      return;
    }

    setSavingTask(true);
    try {
      const nextOrder = tasks.length
        ? Math.max(...tasks.map((x) => x.task_order ?? 0)) + 1
        : 1;

      const created = await api.createJobTask(jobId, {
        task_name: issueText,
        task_desc: solution.trim() || null,
        task_status: "done",
        task_order: nextOrder,
      });

      const taskId = Number((created as { task_id?: number }).task_id);
      const partEntries = Object.entries(selectedParts)
        .map(([k, qty]) => ({ part_id: Number(k), qty: Number(qty) }))
        .filter(
          (x) => Number.isFinite(x.part_id) && x.part_id > 0 && x.qty > 0,
        );

      if (taskId && partEntries.length) {
        for (const p of partEntries) {
          await api.addTaskPart(taskId, { part_id: p.part_id, qty: p.qty });
        }
      }

      setIssue("");
      setSolution("");
      setSelectedParts({});
      setPartsSearch("");
      setPartsOpen(false);
      await fetchAll();
    } catch (e: unknown) {
      handleApiError(e, "Failed to add completed task");
    } finally {
      setSavingTask(false);
    }
  };

  const completedTasks = useMemo(() => {
    return tasks
      .filter((t) => t.task_status === "done")
      .slice()
      .sort((a, b) => {
        const ad = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bd = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        if (bd !== ad) return bd - ad;
        return (b.task_order ?? 0) - (a.task_order ?? 0);
      });
  }, [tasks]);

  const completeJob = async () => {
    if (!canEdit) return;

    if (jobLocked) {
      handleOdometerRequired();
      return;
    }

    if (completedTasks.length === 0) {
      Alert.alert(
        "Add a completed task first",
        "Please add at least 1 completed task before completing the job.",
      );
      return;
    }

    const reportId = jobSummary?.report_id ?? null;

    try {
      await api.updateJobStatus(jobId, { to_status: "closed" });

      if (Number.isFinite(reportId) && (reportId as number) > 0) {
        await api.updateReportStatus(reportId as number, {
          report_status: "closed",
          report_review_action: null,
          report_review_reason: null,
          report_review_by: null,
          report_review_at: new Date().toISOString(),
        });
      }

      Alert.alert(
        "Job completed",
        reportId ? "Job and report have been closed." : "Job has been closed.",
      );
      router.back();
    } catch (e: unknown) {
      handleApiError(e, "Failed to complete job");
    }
  };

  const reportPhotoMedia: LocalMedia[] = useMemo(() => {
    return reportPhotoUrls.map((u) => ({
      localUri: u,
      mime_type: guessMimeFromUrl(u),
    }));
  }, [reportPhotoUrls]);

  const onAfterPhotosChange = (next: LocalMedia[]) => {
    if (jobLocked && next.length > afterMedia.length) {
      handleOdometerRequired();
      return;
    }
    setAfterMedia(next);
  };

  const selectedCount = selectedPartIds.length;

  return (
    <>
      <Stack.Screen options={{ title: "Job Details" }} />

      <ScrollView
        ref={scrollRef}
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Job #{jobId}</Text>

            <Text style={styles.headerSubtitle}>
              {jobSummary?.bus_id ?? "—"}
              {report?.report_location ? ` • ${report.report_location}` : ""}
            </Text>

            {!canEdit && (
              <Text style={styles.readOnlyHint}>
                View only — accept the job to update tasks.
              </Text>
            )}

            {loading && <Text style={styles.readOnlyHint}>Loading…</Text>}
          </View>

          <View style={styles.headerRight}>
            <StatusBadge type={normaliseReportType(jobSummary?.report_type)} />
            <StatusBadge
              type={normalisePriority(jobSummary?.report_priority)}
            />
          </View>
        </View>

        <View style={styles.divider} />

        {/* Initial Odometer gate */}
        {canEdit && (
          <View>
            <View style={[styles.card, jobLocked && styles.cardWarn]}>
              <Text style={styles.cardTitle}>Initial Odometer Reading</Text>

              {hasOdometer ? (
                <Text style={styles.bodyText}>
                  <Text style={{ fontWeight: "900" }}>Recorded: </Text>
                  {jobSummary?.job_odometer}
                </Text>
              ) : (
                <>
                  <Text style={styles.bodyTextMuted}>
                    Enter the current odometer reading before adding completed
                    tasks, uploading after photos, or completing the job.
                  </Text>

                  <View style={[styles.inputWrap, { marginTop: 12 }]}>
                    <TextInput
                      ref={odometerInputRef}
                      value={odometerInput}
                      onChangeText={setOdometerInput}
                      placeholder="e.g., 123456"
                      placeholderTextColor="#6B7280"
                      style={styles.input}
                      keyboardType="number-pad"
                      returnKeyType="done"
                      onSubmitEditing={saveOdometer}
                    />
                  </View>

                  <Pressable
                    style={[
                      styles.actionBtn,
                      styles.updateBtn,
                      { marginTop: 12 },
                      savingOdometer && { opacity: 0.7 },
                    ]}
                    onPress={saveOdometer}
                    disabled={savingOdometer}
                  >
                    <Text style={styles.actionText}>
                      {savingOdometer ? "Saving…" : "Save Odometer"}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        )}

        {/* Initial Report details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Initial Report</Text>

          <Text style={styles.bodyText}>
            <Text style={{ fontWeight: "900" }}>Report ID: </Text>
            {jobSummary?.report_id ?? "—"}
          </Text>

          <Text style={styles.bodyText}>
            <Text style={{ fontWeight: "900" }}>Reported by: </Text>
            {jobSummary?.reporter_name ?? report?.reporter_name ?? "—"}
          </Text>

          <Text style={styles.bodyText}>
            <Text style={{ fontWeight: "900" }}>Priority: </Text>
            {jobSummary?.report_priority ?? report?.report_priority ?? "—"}
          </Text>

          <Text style={[styles.bodyText, { marginTop: 10 }]}>
            {report?.report_desc ?? jobSummary?.job_desc ?? "—"}
          </Text>

          {/* Report photos */}
          <View style={{ marginTop: 14 }}>
            <View style={styles.photoHeaderRow}>
              <Text style={styles.photoTitle}>Report Photos</Text>
              <View style={styles.pill}>
                <Text style={styles.pillText}>
                  {reportPhotoMedia.length} photo
                  {reportPhotoMedia.length === 1 ? "" : "s"}
                </Text>
              </View>
            </View>

            {loadingReportPhotos ? (
              <Text style={styles.bodyTextMuted}>Loading photos…</Text>
            ) : reportPhotoUrls.length === 0 ? (
              <Text style={styles.bodyTextMuted}>No photos uploaded.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.previewRow}
                contentContainerStyle={styles.previewContent}
              >
                {reportPhotoUrls.map((uri, idx) => (
                  <Pressable
                    key={`${uri}-${idx}`}
                    style={styles.thumbWrap}
                    onPress={() => openViewer(idx)}
                  >
                    <View style={styles.thumbClip}>
                      <Image source={{ uri }} style={styles.thumb} />
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>

        {/* Add Completed Task */}
        {canEdit && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add Completed Task</Text>

            <Text style={styles.sectionLabel}>Task Issue</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={issue}
                onChangeText={setIssue}
                placeholder="e.g., Aircon not cooling"
                placeholderTextColor="#6B7280"
                style={styles.input}
                editable={!jobLocked}
                onFocus={() => jobLocked && handleOdometerRequired()}
              />
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 12 }]}>
              Task Solution
            </Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={solution}
                onChangeText={setSolution}
                placeholder="What did you do? (optional)"
                placeholderTextColor="#6B7280"
                style={styles.textarea}
                multiline
                editable={!jobLocked}
                onFocus={() => jobLocked && handleOdometerRequired()}
              />
            </View>

            <View style={[styles.sectionHeaderRow, { marginTop: 12 }]}>
              <Text style={styles.sectionLabel}>Parts Used</Text>
              <View style={styles.pillSoft}>
                <Text style={styles.pillSoftText}>
                  {selectedCount} selected
                </Text>
              </View>
            </View>

            {/* Dropdown trigger */}
            <Pressable
              style={[styles.dropdownTrigger, jobLocked && { opacity: 0.6 }]}
              onPress={() => {
                if (jobLocked) return handleOdometerRequired();
                setPartsOpen((v) => !v);
              }}
            >
              <Text style={styles.dropdownTriggerText}>
                {loadingParts
                  ? "Loading parts…"
                  : partsOpen
                    ? "Close parts list"
                    : "Select parts (search)"}
              </Text>
              <Text style={styles.dropdownChevron}>
                {partsOpen ? "▲" : "▼"}
              </Text>
            </Pressable>

            {/* Dropdown panel */}
            {partsOpen && (
              <View style={styles.dropdownPanel}>
                <View style={styles.inputWrap}>
                  <TextInput
                    value={partsSearch}
                    onChangeText={setPartsSearch}
                    placeholder="Search by name or code…"
                    placeholderTextColor="#6B7280"
                    style={styles.input}
                    autoCorrect={false}
                    editable={!jobLocked}
                  />
                </View>

                <View style={{ marginTop: 10 }}>
                  {filteredDropdownParts.length === 0 ? (
                    <Text style={styles.bodyTextMuted}>
                      {loadingParts ? "Loading parts…" : "No matching parts."}
                    </Text>
                  ) : (
                    <ScrollView
                      style={styles.dropdownList}
                      nestedScrollEnabled
                      keyboardShouldPersistTaps="handled"
                    >
                      {filteredDropdownParts.map((p) => {
                        const qty = selectedParts[p.part_id] ?? 0;
                        const selected = qty > 0;

                        return (
                          <Pressable
                            key={p.part_id}
                            style={[
                              styles.dropdownItem,
                              selected && styles.dropdownItemSelected,
                            ]}
                            onPress={() => {
                              if (jobLocked) return handleOdometerRequired();
                              addOrIncPart(p.part_id);
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.partName}>
                                {p.part_name}{" "}
                                <Text style={styles.partCode}>
                                  ({p.part_code})
                                </Text>
                              </Text>
                              <Text style={styles.partMeta}>
                                Stock: {p.part_stock ?? "—"} • Cost:{" "}
                                {p.part_cost ?? "—"}
                              </Text>
                            </View>

                            {selected && (
                              <View style={styles.qtyBadge}>
                                <Text style={styles.qtyBadgeText}>x{qty}</Text>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              </View>
            )}

            {/* Selected parts cards */}
            <View style={{ marginTop: 12, gap: 10 }}>
              {selectedPartIds.length === 0 ? (
                <Text style={styles.bodyTextMuted}>No parts selected.</Text>
              ) : (
                selectedPartIds.map((pid) => {
                  const p = partsById.get(pid);
                  const qty = selectedParts[pid] ?? 0;
                  if (!p) return null;

                  return (
                    <View key={pid} style={styles.selectedCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.partName}>
                          {p.part_name}{" "}
                          <Text style={styles.partCode}>({p.part_code})</Text>
                        </Text>
                        <Text style={styles.partMeta}>
                          Stock: {p.part_stock ?? "—"} • Cost:{" "}
                          {p.part_cost ?? "—"}
                        </Text>
                      </View>

                      <View style={styles.qtyInline}>
                        <Pressable
                          style={[
                            styles.qtyInlineBtn,
                            jobLocked && { opacity: 0.45 },
                          ]}
                          onPress={() =>
                            jobLocked
                              ? handleOdometerRequired()
                              : changeQty(pid, -1)
                          }
                          disabled={jobLocked}
                        >
                          <Text style={styles.qtyText}>−</Text>
                        </Pressable>

                        <Text style={styles.qtyInlineValue}>{qty}</Text>

                        <Pressable
                          style={[
                            styles.qtyInlineBtn,
                            jobLocked && { opacity: 0.45 },
                          ]}
                          onPress={() =>
                            jobLocked
                              ? handleOdometerRequired()
                              : changeQty(pid, +1)
                          }
                          disabled={jobLocked}
                        >
                          <Text style={styles.qtyText}>+</Text>
                        </Pressable>

                        <Pressable
                          style={[
                            styles.removeBtn,
                            jobLocked && { opacity: 0.45 },
                          ]}
                          onPress={() =>
                            jobLocked
                              ? handleOdometerRequired()
                              : removePart(pid)
                          }
                          disabled={jobLocked}
                        >
                          <Text style={styles.removeBtnText}>Remove</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <Pressable
              style={[
                styles.actionBtn,
                styles.updateBtn,
                { marginTop: 14 },
                (jobLocked || savingTask) && { opacity: 0.6 },
              ]}
              onPress={createCompletedTask}
              disabled={jobLocked || savingTask}
            >
              <Text style={styles.actionText}>
                {savingTask ? "Saving…" : "Add Completed Task"}
              </Text>
            </Pressable>

            {jobLocked && (
              <Text style={[styles.helperText, { marginTop: 10 }]}>
                Save the initial odometer reading to unlock job updates.
              </Text>
            )}
          </View>
        )}

        {/* Completed Tasks list */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Completed Tasks</Text>

          {completedTasks.length === 0 ? (
            <Text style={styles.bodyTextMuted}>No completed tasks yet.</Text>
          ) : (
            completedTasks.map((t) => (
              <View key={t.task_id} style={styles.taskRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskName}>{t.task_name}</Text>
                  {!!t.task_desc && (
                    <Text style={styles.taskDesc}>{t.task_desc}</Text>
                  )}
                  <Text style={styles.taskMeta}>
                    Completed: {formatDateTime(t.completed_at)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* After photos */}
        <View>
          {jobLocked && canEdit ? (
            <Pressable onPress={handleOdometerRequired}>
              <ImagePickerField
                title="After Photos"
                value={afterMedia}
                onChange={onAfterPhotosChange}
                captureLabel="Capture After Photo"
                uploadLabel="Upload After Photo"
                showUploadButton
                readOnly
              />
              <Text style={[styles.helperText, { marginTop: 8 }]}>
                Save the initial odometer reading to upload after photos.
              </Text>
            </Pressable>
          ) : (
            <ImagePickerField
              title="After Photos"
              value={afterMedia}
              onChange={onAfterPhotosChange}
              captureLabel="Capture After Photo"
              uploadLabel="Upload After Photo"
              showUploadButton
              readOnly={!canEdit}
            />
          )}
        </View>

        {/* Complete job */}
        {canEdit && (
          <View style={styles.actions}>
            <Pressable
              style={[
                styles.actionBtn,
                styles.completeBtn,
                (jobLocked || completedTasks.length === 0) && { opacity: 0.6 },
              ]}
              onPress={completeJob}
              disabled={jobLocked || completedTasks.length === 0}
            >
              <Text style={styles.actionText}>Complete Job</Text>
            </Pressable>

            {jobLocked ? (
              <Text style={styles.helperText}>
                Save the initial odometer reading to complete the job.
              </Text>
            ) : completedTasks.length === 0 ? (
              <Text style={styles.helperText}>
                Add at least 1 completed task to complete the job.
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      <ImageViewerOverlay
        visible={viewerVisible}
        imageUrls={viewerUrls}
        startIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  pageContent: { padding: 16, paddingTop: 14, gap: 16 },

  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerLeft: { flex: 1 },
  headerTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: "#111827",
    lineHeight: 38,
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: "700",
    color: "#6B7280",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
  },

  readOnlyHint: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "800",
    color: "#6B7280",
  },

  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginTop: 8,
    marginBottom: 6,
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    shadowOpacity: 0.08,
  },
  cardWarn: {
    borderWidth: 2,
    borderColor: "#EF4444",
    backgroundColor: "#FEF2F2",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },

  bodyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    lineHeight: 22,
  },
  bodyTextMuted: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6B7280",
    lineHeight: 22,
  },

  sectionLabel: {
    fontSize: 13,
    fontWeight: "900",
    color: "#374151",
    marginBottom: 8,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  inputWrap: {
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: { fontSize: 16, color: "#111827" },
  textarea: { minHeight: 70, fontSize: 16, color: "#111827" },

  taskRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  taskName: { fontSize: 16, fontWeight: "900", color: "#111827" },
  taskDesc: { marginTop: 4, fontSize: 14, fontWeight: "700", color: "#374151" },
  taskMeta: { marginTop: 6, fontSize: 13, fontWeight: "800", color: "#6B7280" },

  actions: { gap: 10, marginTop: 4, marginBottom: 28 },
  actionBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  updateBtn: { backgroundColor: "#111827" },
  completeBtn: { backgroundColor: "#16A34A" },
  actionText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  helperText: {
    color: "#6B7280",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },

  photoHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  photoTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  pillText: { fontSize: 14, fontWeight: "600", color: "#111827" },

  pillSoft: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  pillSoftText: { fontSize: 12, fontWeight: "900", color: "#111827" },

  previewRow: { marginTop: 4 },
  previewContent: { paddingRight: 4 },
  thumbWrap: { marginRight: 10 },
  thumbClip: {
    width: 86,
    height: 86,
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  thumb: { width: "100%", height: "100%" },

  // Dropdown UI
  dropdownTrigger: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  dropdownTriggerText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  dropdownChevron: {
    fontSize: 12,
    fontWeight: "900",
    color: "#6B7280",
  },
  dropdownPanel: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#FFFFFF",
  },
  dropdownList: {
    maxHeight: 240,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 10,
    backgroundColor: "#FFFFFF",
  },
  dropdownItemSelected: {
    borderColor: "#111827",
  },

  partName: { fontSize: 14, fontWeight: "900", color: "#111827" },
  partCode: { fontWeight: "900", color: "#6B7280" },
  partMeta: { marginTop: 6, fontSize: 12, fontWeight: "800", color: "#6B7280" },

  qtyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#111827",
  },
  qtyBadgeText: { color: "#fff", fontWeight: "900", fontSize: 12 },

  // Selected cards
  selectedCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#FFFFFF",
  },
  qtyInline: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  qtyInlineBtn: {
    width: 44,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  qtyInlineValue: {
    minWidth: 36,
    textAlign: "center",
    fontWeight: "900",
    color: "#111827",
  },
  qtyText: { fontSize: 18, fontWeight: "900", color: "#111827" },

  removeBtn: {
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  removeBtnText: { fontSize: 12, fontWeight: "900", color: "#111827" },
});
