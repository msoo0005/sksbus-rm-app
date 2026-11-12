// Job Order Registration: a technician logs a repair or maintenance job for
// any bus, with no breakdown report and no approval step. It is saved as a
// completed job straight away (see createJobOrder in the Lambda), so it shows
// in Completed, R&M Closed, the bus history, the KPIs and the Job Completion
// Report like any other job, marked "Job Order".
//
// The form keeps a local draft (Save draft, or automatically as you type), so
// a long entry survives the app being closed.

import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { uploadJobCompletionSelfie, uploadJobPhoto } from "@/api/media";
import AfterPhotoSlots from "@/components/AfterPhotoSlots";
import BusPickerField from "@/components/BusPickerField";
import DraftRestoreBar from "@/components/DraftRestoreBar";
import ImagePickerField, { type LocalMedia } from "@/components/ImagePicker";
import TaskEditorCard, {
  emptyTaskDraft,
  taskDraftProblem,
  taskNameFor,
  type TaskDraft,
  type TaskPartOption,
} from "@/components/TaskEditorCard";
import VerificationModal from "@/components/VerificationModal";
import { useSession } from "@/ctx";
import { useFormDraft } from "@/hooks/useFormDraft";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useI18n } from "@/i18n/i18n-ctx";
import { ROLE_COLORS } from "@/utils/roles";

// Technician orange, as in the mockup.
const ACCENT = ROLE_COLORS.technician.accent;
const MAX_ODOMETER = 9_999_999;

type BusSlot = "front" | "back" | "left" | "right";
const BUS_SLOTS: BusSlot[] = ["front", "back", "left", "right"];
const emptyBusPhotos = (): Record<BusSlot, LocalMedia[]> => ({ front: [], back: [], left: [], right: [] });

type DraftValue = {
  busId: string | null;
  tasks: TaskDraft[];
  confirmed: boolean[];
  odometer: string;
  clusterPhoto: LocalMedia[];
  busPhotos: Record<BusSlot, LocalMedia[]>;
};

export default function JobOrderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { dbUser } = useSession() as any;
  const projectId = useProjectFilter();

  const [busId, setBusId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskDraft[]>([emptyTaskDraft()]);
  // A task is "confirmed" (collapsed, shown as done) once its Add Task is tapped.
  const [confirmed, setConfirmed] = useState<boolean[]>([false]);
  const [odometer, setOdometer] = useState("");
  const [clusterPhoto, setClusterPhoto] = useState<LocalMedia[]>([]);
  const [busPhotos, setBusPhotos] = useState<Record<BusSlot, LocalMedia[]>>(emptyBusPhotos);

  const [parts, setParts] = useState<TaskPartOption[]>([]);
  const [loadingParts, setLoadingParts] = useState(true);
  const [verifyVisible, setVerifyVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .parts()
      .then((rows) => alive && setParts(Array.isArray(rows) ? (rows as TaskPartOption[]) : []))
      .catch(() => alive && setParts([]))
      .finally(() => alive && setLoadingParts(false));
    return () => {
      alive = false;
    };
  }, []);

  // ── Draft ───────────────────────────────────────────────────────────────
  const draftValue = useMemo<DraftValue>(
    () => ({ busId, tasks, confirmed, odometer, clusterPhoto, busPhotos }),
    [busId, tasks, confirmed, odometer, clusterPhoto, busPhotos],
  );
  const isDirty = useMemo(
    () =>
      !!busId ||
      !!odometer.trim() ||
      clusterPhoto.length > 0 ||
      BUS_SLOTS.some((k) => busPhotos[k].length > 0) ||
      tasks.some(
        (d) => d.jobType || d.category || d.issue.trim() || d.workDone.trim() || d.photos.length || Object.keys(d.parts).length,
      ),
    [busId, odometer, clusterPhoto, busPhotos, tasks],
  );
  const draft = useFormDraft<DraftValue>(projectId ? `job-order:${projectId}` : "job-order", draftValue, isDirty);

  const restoreDraft = () => {
    const v = draft.restore();
    if (!v) return;
    setBusId(v.busId ?? null);
    // Drafts saved before tasks had a job type and category get them empty.
    const restoredTasks =
      Array.isArray(v.tasks) && v.tasks.length ? v.tasks.map((d) => ({ ...emptyTaskDraft(), ...d })) : [emptyTaskDraft()];
    setTasks(restoredTasks);
    setConfirmed(restoredTasks.map((_, i) => !!v.confirmed?.[i]));
    setOdometer(v.odometer ?? "");
    setClusterPhoto(v.clusterPhoto ?? []);
    setBusPhotos({ ...emptyBusPhotos(), ...(v.busPhotos ?? {}) });
  };

  // ── Tasks ───────────────────────────────────────────────────────────────
  const updateTask = (i: number, next: TaskDraft) => setTasks((prev) => prev.map((d, j) => (j === i ? next : d)));

  const confirmTask = (i: number) => {
    const problem = taskDraftProblem(tasks[i], t);
    if (problem) {
      Alert.alert(t("taskEditor.incompleteTitle"), problem);
      return;
    }
    setConfirmed((prev) => prev.map((c, j) => (j === i ? true : c)));
  };

  const addAnotherTask = () => {
    const open = tasks.findIndex((d, i) => !confirmed[i]);
    if (open >= 0 && taskDraftProblem(tasks[open], t)) {
      Alert.alert(t("taskEditor.incompleteTitle"), t("jobOrder.finishTaskFirst", { n: open + 1 }));
      return;
    }
    setConfirmed((prev) => [...prev.map(() => true), false]);
    setTasks((prev) => [...prev, emptyTaskDraft()]);
  };

  const removeTask = (i: number) => {
    if (tasks.length === 1) {
      setTasks([emptyTaskDraft()]);
      setConfirmed([false]);
      return;
    }
    Alert.alert(t("jobOrder.removeTaskTitle", { n: i + 1 }), t("jobOrder.removeTaskMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: () => {
          setTasks((prev) => prev.filter((_, j) => j !== i));
          setConfirmed((prev) => prev.filter((_, j) => j !== i));
        },
      },
    ]);
  };

  // ── Validation ──────────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!busId) return t("jobOrder.needBus");
    for (let i = 0; i < tasks.length; i++) {
      const p = taskDraftProblem(tasks[i], t);
      if (p) return `${t("taskEditor.taskN", { n: i + 1 })}: ${p}`;
    }
    const raw = odometer.trim().replace(/,/g, "");
    if (!/^\d+$/.test(raw) || Number(raw) > MAX_ODOMETER) return t("jobOrder.needOdometer");
    if (clusterPhoto.length === 0) return t("reportForm.validationDashboardPhotoRequired");
    if (BUS_SLOTS.some((k) => busPhotos[k].length === 0)) return t("jobOrder.needBusPhotos");
    return null;
  };

  const startSubmit = () => {
    const problem = validate();
    if (problem) {
      Alert.alert(t("jobOrder.cantSubmitTitle"), problem);
      return;
    }
    setVerifyVisible(true);
  };

  // What has already reached the server, so a retry after a part-way failure
  // carries on from where it stopped instead of creating everything twice.
  const progress = useRef<{
    key: string | null;
    jobId: number | null;
    taskIds: (number | null)[];
    partsDone: Set<string>;
    photosDone: Set<string>;
    selfie: string | null;
  }>({ key: null, jobId: null, taskIds: [], partsDone: new Set(), photosDone: new Set(), selfie: null });

  const doSubmit = async ({ selfie, name }: { selfie: LocalMedia; name: string }) => {
    if (submitting || !busId || !tasks[0].category) return;
    setSubmitting(true);
    const p = progress.current;
    const key = JSON.stringify([busId, tasks[0].category, odometer.trim()]);
    if (p.key !== key) {
      progress.current = { key, jobId: null, taskIds: [], partsDone: new Set(), photosDone: new Set(), selfie: null };
    }
    const prog = progress.current;

    try {
      // 1. The job order itself (report + job, already accepted).
      if (!prog.jobId) {
        setProgressText(t("jobOrder.stepCreating"));
        const first = tasks[0];
        const res = await api.createJobOrder({
          bus_id: busId,
          category: first.category!,
          // A maintenance task has no issue; the server names it after the category.
          description: first.jobType === "maintenance" ? "" : first.issue.trim(),
          odometer: Number(odometer.trim().replace(/,/g, "")),
        });
        prog.jobId = res.job_id;
      }
      const jobId = prog.jobId!;

      // 2. Tasks, their parts and photos.
      for (let i = 0; i < tasks.length; i++) {
        const d = tasks[i];
        setProgressText(t("jobOrder.stepTask", { n: i + 1, total: tasks.length }));
        if (!prog.taskIds[i]) {
          const created = await api.createJobTask(jobId, {
            task_name: taskNameFor(d),
            task_job_type: d.jobType,
            task_category: d.category,
            task_desc: d.workDone.trim(),
            task_remark: d.remark.trim() || null,
            task_no_parts: d.noParts,
            task_status: "done",
            task_order: i + 1,
          });
          prog.taskIds[i] = Number(created.task_id);
        }
        const taskId = prog.taskIds[i]!;
        for (const [pid, qty] of Object.entries(d.parts)) {
          const k = `${i}:${pid}`;
          if (prog.partsDone.has(k) || !(qty > 0)) continue;
          await api.addTaskPart(taskId, { part_id: Number(pid), qty });
          prog.partsDone.add(k);
        }
        for (const ph of d.photos) {
          if (prog.photosDone.has(ph.localUri)) continue;
          await uploadJobPhoto(jobId, ph, taskId);
          prog.photosDone.add(ph.localUri);
        }
      }

      // 3. Instrument cluster + the four sides of the bus ("after repair").
      setProgressText(t("jobOrder.stepPhotos"));
      for (const ph of [...clusterPhoto, ...BUS_SLOTS.flatMap((k) => busPhotos[k])]) {
        if (prog.photosDone.has(ph.localUri)) continue;
        await uploadJobPhoto(jobId, ph);
        prog.photosDone.add(ph.localUri);
      }

      // 4. Sign-off, then close (which also closes the report).
      setProgressText(t("jobOrder.stepFinishing"));
      const selfieKey = `${selfie.localUri}|${name}`;
      if (prog.selfie !== selfieKey) {
        await uploadJobCompletionSelfie(jobId, selfie, name);
        prog.selfie = selfieKey;
      }
      await api.updateJobStatus(jobId, { to_status: "closed" });

      draft.clear();
      setVerifyVisible(false);
      progress.current = { key: null, jobId: null, taskIds: [], partsDone: new Set(), photosDone: new Set(), selfie: null };
      Alert.alert(t("jobOrder.savedTitle"), t("jobOrder.savedMessage", { id: jobId }), [
        { text: t("common.ok"), onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert(t("jobOrder.submitFailedTitle"), `${e?.message ?? t("common.unknownError")}\n\n${t("jobOrder.retryHint")}`);
    } finally {
      setSubmitting(false);
      setProgressText(null);
    }
  };

  const saveDraftAndLeave = () => {
    Alert.alert(t("jobOrder.draftSavedTitle"), t("jobOrder.draftSavedMessage"), [
      { text: t("common.ok"), onPress: () => router.back() },
    ]);
  };

  const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const busPhotoCount = BUS_SLOTS.filter((k) => busPhotos[k].length > 0).length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={s.page}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      >
        {draft.pending && (
          <DraftRestoreBar savedAt={draft.savedAt} onRestore={restoreDraft} onDiscard={draft.discard} />
        )}

        {/* Header */}
        <View style={s.card}>
          <View style={s.titleRow}>
            <Text style={s.title}>{t("jobOrder.formTitle")}</Text>
            <View style={s.draftPill}>
              <Text style={s.draftPillText}>{t("jobOrder.draft")}</Text>
            </View>
          </View>
          <View style={s.chips}>
            <View style={s.chip}>
              <FontAwesome5 name="user" size={11} color={ACCENT} />
              <Text style={s.chipText}>{dbUser?.user_name ?? "—"}</Text>
            </View>
            <View style={s.chip}>
              <FontAwesome5 name="calendar-alt" size={11} color={ACCENT} />
              <Text style={s.chipText}>{today}</Text>
            </View>
          </View>
          <View style={s.note}>
            <FontAwesome5 name="info-circle" size={13} color="#2563EB" />
            <Text style={s.noteText}>{t("jobOrder.intro")}</Text>
          </View>
        </View>

        {/* Bus */}
        <Section icon="bus" title={t("jobOrder.sectionBus")}>
          <Text style={s.label}>
            {t("jobOrder.selectBus")} <Text style={s.req}>*</Text>
          </Text>
          <BusPickerField value={busId} onChange={(id) => setBusId(id)} disabled={submitting} accent={ACCENT} />
        </Section>

        {/* Tasks */}
        <Section
          icon="tasks"
          title={t("jobOrder.sectionTasks")}
          right={
            <View style={s.countPill}>
              <Text style={s.countPillText}>{t("jobOrder.taskCount", { count: tasks.length })}</Text>
            </View>
          }
        >
          <View style={{ gap: 12 }}>
            {tasks.map((d, i) => (
              <TaskEditorCard
                key={i}
                index={i + 1}
                value={d}
                onChange={(next) => updateTask(i, next)}
                parts={parts}
                loadingParts={loadingParts}
                disabled={submitting}
                collapsed={confirmed[i]}
                onToggleCollapsed={() => setConfirmed((prev) => prev.map((c, j) => (j === i ? !c : c)))}
                onDelete={() => removeTask(i)}
                confirmLabel={t("jobDetail.addTaskButton")}
                onConfirm={() => confirmTask(i)}
                accent={ACCENT}
              />
            ))}
          </View>
          <Pressable
            style={({ pressed }) => [s.addTask, pressed && { opacity: 0.7 }]}
            onPress={addAnotherTask}
            disabled={submitting}
          >
            <FontAwesome5 name="plus" size={13} color={ACCENT} />
            <Text style={s.addTaskText}>{t("jobOrder.addAnotherTask")}</Text>
          </Pressable>
        </Section>

        {/* Odometer */}
        <Section icon="tachometer-alt" title={t("jobOrder.sectionOdometer")}>
          <Text style={s.label}>
            {t("jobOrder.odometerLabel")} <Text style={s.req}>*</Text>
          </Text>
          <View style={s.odoWrap}>
            <TextInput
              value={odometer}
              onChangeText={(v) => setOdometer(v.replace(/[^\d,]/g, ""))}
              placeholder="0"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              style={s.odoInput}
              editable={!submitting}
            />
            <Text style={s.odoUnit}>km</Text>
          </View>
          <View style={{ marginTop: 14 }}>
            <ImagePickerField
              title={t("reportForm.dashboardPhotoTitle")}
              required
              value={clusterPhoto}
              onChange={setClusterPhoto}
              maxItems={1}
              readOnly={submitting}
            />
          </View>
          <Text style={s.hint}>{t("jobOrder.odometerHint")}</Text>
        </Section>

        {/* Bus photos */}
        <Section
          icon="camera"
          title={t("jobOrder.sectionBusPhotos")}
          right={
            <View style={[s.countPill, busPhotoCount === 4 && s.countPillDone]}>
              <Text style={[s.countPillText, busPhotoCount === 4 && s.countPillDoneText]}>
                {t("jobOrder.ofFour", { count: busPhotoCount })}
              </Text>
            </View>
          }
        >
          <AfterPhotoSlots
            title=""
            slots={[
              { key: "front", label: t("jobDetail.photoSlotFront"), icon: "arrow-up" },
              { key: "back", label: t("jobDetail.photoSlotBack"), icon: "arrow-down" },
              { key: "left", label: t("jobDetail.photoSlotLeft"), icon: "arrow-left" },
              { key: "right", label: t("jobDetail.photoSlotRight"), icon: "arrow-right" },
            ]}
            value={busPhotos}
            onChange={(k, next) => setBusPhotos((prev) => ({ ...prev, [k as BusSlot]: next }))}
            disabled={submitting}
          />
          <Text style={s.hint}>{t("jobOrder.busPhotosHint")}</Text>
        </Section>
      </ScrollView>

      {/* Footer */}
      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable style={s.draftBtn} onPress={saveDraftAndLeave} disabled={submitting}>
          <Text style={s.draftBtnText}>{t("jobOrder.saveDraft")}</Text>
        </Pressable>
        <Pressable
          style={[s.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={startSubmit}
          disabled={submitting}
        >
          <FontAwesome5 name="paper-plane" size={13} color="#fff" />
          <Text style={s.submitText}>{submitting ? progressText ?? t("common.saving") : t("jobOrder.submit")}</Text>
        </Pressable>
      </View>

      <VerificationModal
        visible={verifyVisible}
        title={t("jobOrder.signoffTitle")}
        message={t("jobOrder.signoffMessage")}
        confirmLabel={t("jobOrder.submit")}
        submitting={submitting}
        onCancel={() => !submitting && setVerifyVisible(false)}
        onConfirm={doSubmit}
      />
    </KeyboardAvoidingView>
  );
}

function Section({
  icon,
  title,
  right,
  children,
}: {
  icon: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={s.sectionHead}>
        <View style={s.sectionIcon}>
          <FontAwesome5 name={icon as any} size={13} color="#4B5563" />
        </View>
        <Text style={s.sectionTitle}>{title}</Text>
        {right}
      </View>
      <View style={s.sectionDivider} />
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F3F4F6" },
  content: { padding: 14, gap: 14, paddingBottom: 40, width: "100%", maxWidth: 720, alignSelf: "center" },
  card: { backgroundColor: "#fff", borderRadius: 22, padding: 18 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { fontSize: 26, fontWeight: "800", color: "#111827", flex: 1 },
  draftPill: { backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  draftPillText: { fontSize: 12, fontWeight: "700", color: "#374151" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: `${ACCENT}55`,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: { fontSize: 13, fontWeight: "600", color: ACCENT },
  note: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
  },
  noteText: { flex: 1, fontSize: 13, color: "#1E40AF", lineHeight: 18 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: "#111827" },
  sectionDivider: { height: 1, backgroundColor: "#F3F4F6", marginVertical: 14 },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6B7280",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  req: { color: "#DC2626" },
  countPill: { backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  countPillText: { fontSize: 12, fontWeight: "700", color: "#374151" },
  countPillDone: { backgroundColor: "#DCFCE7" },
  countPillDoneText: { color: "#15803D" },
  addTask: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: `${ACCENT}66`,
    borderRadius: 14,
    paddingVertical: 14,
  },
  addTaskText: { fontSize: 15, fontWeight: "700", color: ACCENT },
  odoWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  odoInput: { flex: 1, fontSize: 22, fontWeight: "800", color: "#111827", paddingVertical: 12 },
  odoUnit: { fontSize: 15, color: "#6B7280" },
  hint: { fontSize: 12, color: "#6B7280", marginTop: 10 },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  draftBtn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  draftBtnText: { fontSize: 15, fontWeight: "700", color: "#111827" },
  submitBtn: {
    flex: 2,
    height: 52,
    borderRadius: 16,
    backgroundColor: ACCENT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 10,
  },
  submitText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
