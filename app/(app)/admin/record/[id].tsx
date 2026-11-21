// Admin "Reports & jobs" → one record: correct the report, move the job to
// any step or technician, fix its tasks, parts and odometer, or delete it
// permanently. Every change is written to Job Progress by the server.

import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import {
  api,
  type AdminPerson,
  type AdminReportEdit,
  type CatalogPart,
  type JobDetails,
  type JobDetailTask,
  type JobState,
} from "@/api/client";
import BusPickerField from "@/components/BusPickerField";
import BusSystemPicker from "@/components/BusSystemPicker";
import Sheet from "@/components/Sheet";
import { useI18n } from "@/i18n/i18n-ctx";
import { ADMIN_STATUS_COLORS } from "@/utils/adminRecords";
import { formatBusLabel } from "@/utils/busLabel";
import { busSystemLabel } from "@/utils/busSystems";
import { formatDateTime } from "@/utils/datetime";
import { reportTypeTitleLabel } from "@/utils/reportType";
import { KEYBOARD_DONE_ID } from "@/components/KeyboardDone";

const ACCENT = "#1F2937";
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const TARGETS: JobState[] = ["approved", "accepted", "arrived", "pending_approval", "closed"];

type Report = {
  report_id: number;
  report_ref_no: string | null;
  report_type: string;
  report_status: string | null;
  report_desc: string | null;
  report_priority: string | null;
  report_issue_type: string | null;
  report_location: string | null;
  report_uploaded_at: string | null;
  bus_id: string;
  bus_ev_no: string | null;
  project_id: string | null;
  job_id: number | null;
  reporter_name: string | null;
};

function reportOnlyStatus(r: Report) {
  const s = String(r.report_status ?? "").trim().toLowerCase();
  if (s === "draft") return "draft";
  if (s === "declined") return "declined";
  if (s === "closed") return "closed";
  return "pending";
}

export default function AdminRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const reportId = Number(id);
  const router = useRouter();
  const { t } = useI18n();

  const [report, setReport] = useState<Report | null>(null);
  const [details, setDetails] = useState<JobDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = (await api.getReport(reportId)) as Report;
      setReport(r);
      setDetails(r.job_id != null ? await api.jobDetails(Number(r.job_id)) : null);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? t("common.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [reportId, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} />;
  if (!report) return <Text style={s.error}>{error ?? t("common.failedToLoad")}</Text>;

  const ref = report.report_ref_no ?? details?.job.ref_no ?? `#${report.report_id}`;
  const status = details ? details.job.state : reportOnlyStatus(report);
  const c = ADMIN_STATUS_COLORS[status] ?? ADMIN_STATUS_COLORS.draft;

  return (
    <KeyboardAwareScrollView
      style={s.page}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      bottomOffset={24}
    >
      <View style={s.head}>
        <Text style={s.ref}>{ref}</Text>
        <Text style={s.title}>
          {formatBusLabel(report.bus_id, report.bus_ev_no)} · {reportTypeTitleLabel(report.report_type, t)}
        </Text>
        <View style={[s.pill, { backgroundColor: c.bg }]}>
          <Text style={[s.pillText, { color: c.fg }]}>{t(`adminRecords.status.${status}`)}</Text>
        </View>
      </View>

      <ReportCard report={report} onSaved={load} />

      {details ? (
        <>
          <JobCard details={details} projectId={report.project_id} onChanged={load} />
          <TasksCard details={details} onChanged={load} />
        </>
      ) : (
        <View style={s.card}>
          <Text style={s.cardTitle}>{t("adminRecords.job")}</Text>
          <Text style={s.muted}>{t("adminRecords.noJob")}</Text>
        </View>
      )}

      <DeleteCard
        refNo={ref}
        hasJob={!!details}
        hasOrders={!!details?.followups.some((f) => f.job_order)}
        onDelete={async (confirm) => {
          const res = await api.adminDeleteRecord(report.report_id, confirm);
          Alert.alert(
            t("adminRecords.delete.done", { ref: res.ref_no }),
            res.files.failed ? t("adminRecords.delete.filesLeft", { count: res.files.failed }) : undefined,
          );
          router.back();
        }}
      />
    </KeyboardAwareScrollView>
  );
}

// ───────────────────────── Report ─────────────────────────

function ReportCard({ report, onSaved }: { report: Report; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [desc, setDesc] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  const [category, setCategory] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [busId, setBusId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const startEdit = () => {
    setDesc(report.report_desc ?? "");
    setPriority(report.report_priority ?? "medium");
    setCategory(report.report_issue_type ?? null);
    setLocation(report.report_location ?? "");
    setBusId(report.bus_id);
    setReason("");
    setEditing(true);
  };

  const save = async () => {
    const body: AdminReportEdit = {};
    if (desc.trim() !== (report.report_desc ?? "")) body.report_desc = desc.trim();
    if (priority !== report.report_priority) body.report_priority = priority;
    if ((category ?? null) !== (report.report_issue_type ?? null)) body.report_issue_type = category;
    if (location.trim() !== (report.report_location ?? "")) body.report_location = location.trim() || null;
    if (busId && busId !== report.bus_id) body.bus_id = busId;
    if (!Object.keys(body).length) {
      setEditing(false);
      return;
    }
    if (reason.trim()) body.reason = reason.trim();
    setSaving(true);
    try {
      await api.adminEditReport(report.report_id, body);
      setEditing(false);
      await onSaved();
    } catch (e: any) {
      Alert.alert(t("adminRecords.saveFailed"), e?.message ?? "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>{t("adminRecords.report")}</Text>
        {!editing && (
          <Pressable onPress={startEdit} hitSlop={8} style={s.linkBtn}>
            <FontAwesome5 name="pen" size={11} color={ACCENT} />
            <Text style={s.linkText}>{t("adminRecords.edit")}</Text>
          </Pressable>
        )}
      </View>

      {!editing ? (
        <>
          <Row label={t("adminRecords.field.description")} value={report.report_desc} />
          <Row
            label={t("adminRecords.field.priority")}
            value={report.report_priority ? t(`adminRecords.priority.${report.report_priority}`) : null}
          />
          <Row
            label={t("adminRecords.field.category")}
            value={report.report_issue_type ? busSystemLabel(report.report_issue_type, t) : t("adminRecords.notSet")}
          />
          <Row label={t("adminRecords.field.location")} value={report.report_location} />
          <Row label={t("adminRecords.field.reporter")} value={report.reporter_name} />
          <Row
            label={t("adminRecords.field.submitted")}
            value={report.report_uploaded_at ? formatDateTime(report.report_uploaded_at) : null}
          />
        </>
      ) : (
        <>
          <Label text={t("adminRecords.field.bus")} />
          <BusPickerField value={busId} onChange={(id) => setBusId(id)} accent={ACCENT} />
          <Label text={t("adminRecords.field.description")} />
          <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID} value={desc} onChangeText={setDesc} style={[s.input, s.multi]} multiline maxLength={2000} />
          <Label text={t("adminRecords.field.priority")} />
          <Chips
            options={PRIORITIES.map((p) => ({ key: p, label: t(`adminRecords.priority.${p}`) }))}
            value={priority}
            onChange={setPriority}
          />
          <Label text={t("adminRecords.field.category")} />
          <BusSystemPicker value={category} onChange={(k) => setCategory(k)} accent={ACCENT} />
          <Label text={t("adminRecords.field.location")} />
          <TextInput value={location} onChangeText={setLocation} style={s.input} maxLength={500} />
          <Label text={t("adminRecords.reasonOptional")} />
          <TextInput
            value={reason}
            onChangeText={setReason}
            style={s.input}
            placeholder={t("adminRecords.reasonPlaceholder")}
            placeholderTextColor="#9CA3AF"
            maxLength={300}
          />
          <Buttons
            onCancel={() => setEditing(false)}
            onSave={save}
            saving={saving}
            saveLabel={t("common.save")}
          />
        </>
      )}
    </View>
  );
}

// ───────────────────────── Job ─────────────────────────

function JobCard({ details, projectId, onChanged }: { details: JobDetails; projectId: string | null; onChanged: () => Promise<void> }) {
  const { t } = useI18n();
  const router = useRouter();
  const job = details.job;
  const [sheet, setSheet] = useState<"status" | "assign" | "odometer" | null>(null);

  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>{t("adminRecords.job")}</Text>
        <Pressable onPress={() => router.push(`/job/${job.job_id}` as any)} hitSlop={8} style={s.linkBtn}>
          <Text style={s.linkText}>{t("adminRecords.openJob")}</Text>
          <FontAwesome5 name="chevron-right" size={10} color={ACCENT} />
        </Pressable>
      </View>
      <Row label={t("adminRecords.jobStatus")} value={t(`adminRecords.status.${job.state}`)} />
      <Row
        label={t("adminRecords.technician")}
        value={job.technician ? `${job.technician.name ?? "—"}${job.technician.username ? `  @${job.technician.username}` : ""}` : t("adminRecords.noTechnician")}
      />
      <Row label={t("adminRecords.odometer")} value={job.odometer != null ? `${job.odometer.toLocaleString()} km` : t("adminRecords.notSet")} />

      <View style={s.actions}>
        <ActionBtn icon="exchange-alt" label={t("adminRecords.changeStatus")} onPress={() => setSheet("status")} />
        <ActionBtn icon="user-edit" label={t("adminRecords.reassign")} onPress={() => setSheet("assign")} />
        <ActionBtn icon="tachometer-alt" label={t("adminRecords.fixOdometer")} onPress={() => setSheet("odometer")} />
      </View>

      <StatusSheet
        visible={sheet === "status"}
        jobId={job.job_id}
        current={job.state}
        onClose={() => setSheet(null)}
        onDone={onChanged}
      />
      <AssignSheet
        visible={sheet === "assign"}
        jobId={job.job_id}
        projectId={projectId}
        currentId={job.technician?.user_id ?? null}
        onClose={() => setSheet(null)}
        onDone={onChanged}
      />
      <OdometerSheet
        visible={sheet === "odometer"}
        jobId={job.job_id}
        current={job.odometer}
        onClose={() => setSheet(null)}
        onDone={onChanged}
      />
    </View>
  );
}

function StatusSheet({
  visible,
  jobId,
  current,
  onClose,
  onDone,
}: {
  visible: boolean;
  jobId: number;
  current: JobState;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [to, setTo] = useState<JobState | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (visible) {
      setTo(null);
      setReason("");
    }
  }, [visible]);

  const ok = !!to && to !== current && !!reason.trim();
  const apply = async () => {
    if (!ok || !to) return;
    setSaving(true);
    try {
      await api.adminSetJobStatus(jobId, { to, reason: reason.trim() });
      onClose();
      await onDone();
    } catch (e: any) {
      Alert.alert(t("adminRecords.saveFailed"), e?.message ?? "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title={t("adminRecords.statusSheet.title")}
      onClose={onClose}
      tall
      footer={<PrimaryBtn label={t("adminRecords.statusSheet.apply")} disabled={!ok} busy={saving} onPress={apply} />}
    >
      <Label text={t("adminRecords.statusSheet.moveTo")} />
      {TARGETS.map((k) => {
        const isCurrent = k === current;
        const sel = k === to;
        return (
          <Pressable
            key={k}
            disabled={isCurrent}
            onPress={() => setTo(k)}
            style={[s.option, sel && s.optionSel, isCurrent && { opacity: 0.5 }]}
          >
            <FontAwesome5 name={sel ? "dot-circle" : "circle"} size={16} color={sel ? ACCENT : "#9CA3AF"} />
            <View style={{ flex: 1 }}>
              <Text style={s.optionTitle}>
                {t(`adminRecords.status.${k}`)}
                {isCurrent ? `  · ${t("adminRecords.statusSheet.current")}` : ""}
              </Text>
              <Text style={s.optionDesc}>{t(`adminRecords.statusSheet.effect.${k}`)}</Text>
            </View>
          </Pressable>
        );
      })}
      <Label text={t("adminRecords.reasonRequired")} />
      <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
        value={reason}
        onChangeText={setReason}
        style={[s.input, s.multi]}
        multiline
        maxLength={300}
        placeholder={t("adminRecords.reasonPlaceholder")}
        placeholderTextColor="#9CA3AF"
      />
    </Sheet>
  );
}

function AssignSheet({
  visible,
  jobId,
  projectId,
  currentId,
  onClose,
  onDone,
}: {
  visible: boolean;
  jobId: number;
  projectId: string | null;
  currentId: number | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [people, setPeople] = useState<AdminPerson[] | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPick(null);
    setReason("");
    api.adminTechnicians(projectId).then(setPeople).catch(() => setPeople([]));
  }, [visible, projectId]);

  const apply = async () => {
    if (pick == null) return;
    setSaving(true);
    try {
      await api.adminAssignJob(jobId, { technician_user_id: pick, reason: reason.trim() || undefined });
      onClose();
      await onDone();
    } catch (e: any) {
      Alert.alert(t("adminRecords.saveFailed"), e?.message ?? "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title={t("adminRecords.reassignSheet.title")}
      onClose={onClose}
      tall
      footer={
        <PrimaryBtn label={t("adminRecords.reassignSheet.apply")} disabled={pick == null} busy={saving} onPress={apply} />
      }
    >
      {people == null ? (
        <ActivityIndicator style={{ marginVertical: 20 }} />
      ) : !people.length ? (
        <Text style={s.muted}>{t("adminRecords.reassignSheet.none")}</Text>
      ) : (
        people.map((p) => {
          const isCurrent = p.user_id === currentId;
          const sel = p.user_id === pick;
          return (
            <Pressable
              key={p.user_id}
              disabled={isCurrent}
              onPress={() => setPick(p.user_id)}
              style={[s.option, sel && s.optionSel, isCurrent && { opacity: 0.5 }]}
            >
              <FontAwesome5 name={sel ? "dot-circle" : "circle"} size={16} color={sel ? ACCENT : "#9CA3AF"} />
              <View style={{ flex: 1 }}>
                <Text style={s.optionTitle}>
                  {p.name}
                  {isCurrent ? `  · ${t("adminRecords.reassignSheet.current")}` : ""}
                </Text>
                <Text style={s.optionDesc}>
                  {[p.username ? `@${p.username}` : null, t(`roles.${p.role}`)].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
      <Label text={t("adminRecords.reasonOptional")} />
      <TextInput
        value={reason}
        onChangeText={setReason}
        style={s.input}
        maxLength={300}
        placeholder={t("adminRecords.reasonPlaceholder")}
        placeholderTextColor="#9CA3AF"
      />
    </Sheet>
  );
}

function OdometerSheet({
  visible,
  jobId,
  current,
  onClose,
  onDone,
}: {
  visible: boolean;
  jobId: number;
  current: number | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [override, setOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (visible) {
      setValue(current != null ? String(current) : "");
      setOverride(false);
    }
  }, [visible, current]);

  const ok = /^\d+$/.test(value) && Number(value) > 0;
  const apply = async () => {
    if (!ok) return;
    setSaving(true);
    try {
      await api.adminSetOdometer(jobId, Number(value), override);
      onClose();
      await onDone();
    } catch (e: any) {
      Alert.alert(t("adminRecords.saveFailed"), e?.message ?? "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title={t("adminRecords.odometerSheet.title")}
      onClose={onClose}
      footer={<PrimaryBtn label={t("adminRecords.odometerSheet.apply")} disabled={!ok} busy={saving} onPress={apply} />}
    >
      <Label text={t("adminRecords.odometerSheet.reading")} />
      <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
        value={value}
        onChangeText={(v) => setValue(v.replace(/\D/g, ""))}
        style={s.input}
        keyboardType="number-pad"
        maxLength={9}
      />
      <View style={s.switchRow}>
        <Text style={s.switchText}>{t("adminRecords.odometerSheet.override")}</Text>
        <Switch value={override} onValueChange={setOverride} />
      </View>
      <Text style={s.optionDesc}>{t("adminRecords.odometerSheet.overrideHint")}</Text>
    </Sheet>
  );
}

// ───────────────────────── Tasks & parts ─────────────────────────

function TasksCard({ details, onChanged }: { details: JobDetails; onChanged: () => Promise<void> }) {
  const { t } = useI18n();
  const [addingTo, setAddingTo] = useState<JobDetailTask | null>(null);

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{t("adminRecords.tasks")}</Text>
      {!details.tasks.length && <Text style={s.muted}>{t("adminRecords.task.none")}</Text>}
      {details.tasks.map((task) => (
        <TaskBlock key={task.task_id} task={task} onChanged={onChanged} onAddPart={() => setAddingTo(task)} />
      ))}
      <AddPartSheet task={addingTo} onClose={() => setAddingTo(null)} onDone={onChanged} />
    </View>
  );
}

function TaskBlock({ task, onChanged, onAddPart }: { task: JobDetailTask; onChanged: () => Promise<void>; onAddPart: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [jobType, setJobType] = useState<string>("repair");
  const [category, setCategory] = useState<string | null>(null);
  const [workDone, setWorkDone] = useState("");
  const [remark, setRemark] = useState("");

  const startEdit = () => {
    setName(task.name);
    setJobType(task.job_type ?? "repair");
    setCategory(task.category?.key ?? null);
    setWorkDone(task.work_done ?? "");
    setRemark(task.remark ?? "");
    setEditing(true);
  };

  const save = async () => {
    const body: Record<string, unknown> = {};
    if (name.trim() && name.trim() !== task.name) body.task_name = name.trim();
    if (jobType !== task.job_type) body.task_job_type = jobType;
    if (category && category !== task.category?.key) body.task_category = category;
    if (workDone.trim() !== (task.work_done ?? "")) body.task_desc = workDone.trim() || null;
    if (remark.trim() !== (task.remark ?? "")) body.task_remark = remark.trim() || null;
    if (!Object.keys(body).length) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.updateJobTask(task.task_id, body);
      setEditing(false);
      await onChanged();
    } catch (e: any) {
      Alert.alert(t("adminRecords.saveFailed"), e?.message ?? "");
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert(t("adminRecords.task.removeTitle"), t("adminRecords.task.removeBody", { name: task.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("adminRecords.task.remove"),
        style: "destructive",
        onPress: async () => {
          try {
            await api.adminDeleteTask(task.task_id);
            await onChanged();
          } catch (e: any) {
            Alert.alert(t("adminRecords.saveFailed"), e?.message ?? "");
          }
        },
      },
    ]);

  return (
    <View style={s.task}>
      <View style={s.cardHead}>
        <Text style={s.taskTitle} numberOfLines={2}>
          {task.no}. {task.name}
        </Text>
        {!editing && (
          <>
            <Pressable onPress={startEdit} hitSlop={8} style={s.iconBtn} accessibilityLabel={t("adminRecords.task.edit")}>
              <FontAwesome5 name="pen" size={12} color={ACCENT} />
            </Pressable>
            <Pressable onPress={remove} hitSlop={8} style={s.iconBtn} accessibilityLabel={t("adminRecords.task.remove")}>
              <FontAwesome5 name="trash-alt" size={12} color="#DC2626" />
            </Pressable>
          </>
        )}
      </View>

      {!editing ? (
        <>
          <Text style={s.taskMeta}>
            {[
              task.job_type ? t(`adminRecords.task.${task.job_type}`) : null,
              task.category ? `${task.category.no} · ${task.category.name}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {!!task.work_done && <Text style={s.taskBody}>{task.work_done}</Text>}
          {!!task.remark && <Text style={s.taskRemark}>{task.remark}</Text>}
        </>
      ) : (
        <>
          <Label text={t("adminRecords.task.name")} />
          <TextInput value={name} onChangeText={setName} style={s.input} maxLength={255} />
          <Label text={t("adminRecords.task.jobType")} />
          <Chips
            options={[
              { key: "repair", label: t("adminRecords.task.repair") },
              { key: "maintenance", label: t("adminRecords.task.maintenance") },
            ]}
            value={jobType}
            onChange={setJobType}
          />
          <Label text={t("adminRecords.task.category")} />
          <BusSystemPicker value={category} onChange={(k) => setCategory(k)} accent={ACCENT} />
          <Label text={t("adminRecords.task.workDone")} />
          <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID} value={workDone} onChangeText={setWorkDone} style={[s.input, s.multi]} multiline maxLength={2000} />
          <Label text={t("adminRecords.task.remark")} />
          <TextInput value={remark} onChangeText={setRemark} style={s.input} maxLength={500} />
          <Buttons onCancel={() => setEditing(false)} onSave={save} saving={saving} saveLabel={t("common.save")} />
        </>
      )}

      <Text style={s.partsHead}>{t("adminRecords.task.parts")}</Text>
      {!task.parts.length && <Text style={s.muted}>{t("adminRecords.task.noParts")}</Text>}
      {task.parts.map((p) => (
        <PartRow key={p.part_id} taskId={task.task_id} part={p} onChanged={onChanged} />
      ))}
      <Pressable onPress={onAddPart} style={s.addPart} hitSlop={6}>
        <FontAwesome5 name="plus" size={11} color={ACCENT} />
        <Text style={s.linkText}>{t("adminRecords.task.addPart")}</Text>
      </Pressable>
    </View>
  );
}

function PartRow({
  taskId,
  part,
  onChanged,
}: {
  taskId: number;
  part: JobDetailTask["parts"][number];
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [qty, setQty] = useState(String(part.qty));
  useEffect(() => setQty(String(part.qty)), [part.qty]);

  const saveQty = async () => {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0 || n === part.qty) {
      setQty(String(part.qty));
      return;
    }
    try {
      await api.adminSetTaskPartQty(taskId, part.part_id, n);
      await onChanged();
    } catch (e: any) {
      setQty(String(part.qty));
      Alert.alert(t("adminRecords.saveFailed"), e?.message ?? "");
    }
  };

  const remove = () =>
    Alert.alert(t("adminRecords.task.removePart"), t("adminRecords.task.removePartBody", { name: part.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: async () => {
          try {
            await api.adminRemoveTaskPart(taskId, part.part_id);
            await onChanged();
          } catch (e: any) {
            Alert.alert(t("adminRecords.saveFailed"), e?.message ?? "");
          }
        },
      },
    ]);

  return (
    <View style={s.partRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.partName} numberOfLines={1}>
          {part.name}
        </Text>
        {!!part.code && <Text style={s.partCode}>{part.code}</Text>}
      </View>
      <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
        value={qty}
        onChangeText={setQty}
        onEndEditing={saveQty}
        onSubmitEditing={saveQty}
        keyboardType="decimal-pad"
        style={s.qty}
        selectTextOnFocus
      />
      <Text style={s.unit}>{part.unit}</Text>
      <Pressable onPress={remove} hitSlop={8} style={s.iconBtn} accessibilityLabel={t("adminRecords.task.removePart")}>
        <FontAwesome5 name="times" size={13} color="#DC2626" />
      </Pressable>
    </View>
  );
}

function AddPartSheet({ task, onClose, onDone }: { task: JobDetailTask | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<CatalogPart[] | null>(null);
  const [search, setSearch] = useState("");
  const [pick, setPick] = useState<CatalogPart | null>(null);
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!task) return;
    setSearch("");
    setPick(null);
    setQty("1");
    if (!catalog) api.parts().then(setCatalog).catch(() => setCatalog([]));
  }, [task, catalog]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = catalog ?? [];
    return (q
      ? list.filter((p) => `${p.part_name} ${p.part_code} ${p.part_brand ?? ""}`.toLowerCase().includes(q))
      : list
    ).slice(0, 50);
  }, [catalog, search]);

  const ok = !!pick && Number(qty) > 0;
  const apply = async () => {
    if (!task || !pick || !ok) return;
    setSaving(true);
    try {
      await api.addTaskPart(task.task_id, { part_id: pick.part_id, qty: Number(qty) });
      onClose();
      await onDone();
    } catch (e: any) {
      Alert.alert(t("adminRecords.saveFailed"), e?.message ?? "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={!!task}
      title={t("adminRecords.task.addPart")}
      subtitle={task ? `${task.no}. ${task.name}` : undefined}
      onClose={onClose}
      tall
      footer={
        <View style={{ flexDirection: "row", gap: 10, flex: 1, alignItems: "center" }}>
          <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
            value={qty}
            onChangeText={setQty}
            keyboardType="decimal-pad"
            style={[s.qty, { height: 48, width: 72 }]}
            selectTextOnFocus
          />
          <View style={{ flex: 1 }}>
            <PrimaryBtn label={t("adminRecords.task.addPart")} disabled={!ok} busy={saving} onPress={apply} />
          </View>
        </View>
      }
    >
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={t("adminRecords.task.searchParts")}
        placeholderTextColor="#9CA3AF"
        style={s.input}
        autoCorrect={false}
      />
      {catalog == null ? (
        <ActivityIndicator style={{ marginVertical: 20 }} />
      ) : (
        shown.map((p) => {
          const sel = p.part_id === pick?.part_id;
          return (
            <Pressable key={p.part_id} onPress={() => setPick(p)} style={[s.option, sel && s.optionSel]}>
              <FontAwesome5 name={sel ? "dot-circle" : "circle"} size={16} color={sel ? ACCENT : "#9CA3AF"} />
              <View style={{ flex: 1 }}>
                <Text style={s.optionTitle}>{p.part_name}</Text>
                <Text style={s.optionDesc}>
                  {[p.part_code, p.part_brand, p.part_unit].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
    </Sheet>
  );
}

// ───────────────────────── Delete ─────────────────────────

function DeleteCard({
  refNo,
  hasJob,
  hasOrders,
  onDelete,
}: {
  refNo: string;
  hasJob: boolean;
  hasOrders: boolean;
  onDelete: (confirm: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = typed.trim().toUpperCase() === refNo.toUpperCase();

  const go = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await onDelete(typed.trim());
    } catch (e: any) {
      Alert.alert(t("adminRecords.delete.failed"), e?.message ?? "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.card, s.danger]}>
      <Text style={s.dangerLabel}>{t("adminRecords.delete.section")}</Text>
      {!open ? (
        <Pressable style={s.deleteBtn} onPress={() => setOpen(true)}>
          <FontAwesome5 name="trash-alt" size={13} color="#DC2626" />
          <Text style={s.deleteText}>{t("adminRecords.delete.button")}</Text>
        </Pressable>
      ) : (
        <>
          <Text style={s.dangerTitle}>{t("adminRecords.delete.title")}</Text>
          <Text style={s.dangerBody}>{t(hasJob ? "adminRecords.delete.body" : "adminRecords.delete.bodyNoJob")}</Text>
          {hasOrders && <Text style={s.dangerBody}>{t("adminRecords.delete.orders")}</Text>}
          <Label text={t("adminRecords.delete.typeToConfirm", { ref: refNo })} />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            style={s.input}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={refNo}
            placeholderTextColor="#D1D5DB"
          />
          <View style={[s.row, { marginTop: 12 }]}>
            <Pressable style={s.secondary} onPress={() => { setOpen(false); setTyped(""); }} disabled={busy}>
              <Text style={s.secondaryText}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable style={[s.primary, s.primaryDanger, (!ok || busy) && { opacity: 0.45 }]} disabled={!ok || busy} onPress={go}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{t("adminRecords.delete.button")}</Text>}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// ───────────────────────── Small pieces ─────────────────────────

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={s.kv}>
      <Text style={s.k}>{label}</Text>
      <Text style={s.v}>{value || "—"}</Text>
    </View>
  );
}

function Label({ text }: { text: string }) {
  return <Text style={s.label}>{text}</Text>;
}

function Chips({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const sel = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[s.chip, sel && s.chipSel]}>
            <Text style={[s.chipText, sel && { color: "#fff" }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ActionBtn({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.action, pressed && { opacity: 0.7 }]}>
      <FontAwesome5 name={icon as any} size={13} color={ACCENT} />
      <Text style={s.actionText}>{label}</Text>
    </Pressable>
  );
}

function PrimaryBtn({ label, disabled, busy, onPress }: { label: string; disabled?: boolean; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[s.primary, { flex: 1 }, (disabled || busy) && { opacity: 0.45 }]} disabled={disabled || busy} onPress={onPress}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{label}</Text>}
    </Pressable>
  );
}

function Buttons({ onCancel, onSave, saving, saveLabel }: { onCancel: () => void; onSave: () => void; saving: boolean; saveLabel: string }) {
  const { t } = useI18n();
  return (
    <View style={[s.row, { marginTop: 14 }]}>
      <Pressable style={s.secondary} onPress={onCancel} disabled={saving}>
        <Text style={s.secondaryText}>{t("common.cancel")}</Text>
      </Pressable>
      <PrimaryBtn label={saveLabel} busy={saving} onPress={onSave} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, gap: 14, paddingBottom: 48, width: "100%", maxWidth: 720, alignSelf: "center" },
  error: { textAlign: "center", color: "#B91C1C", marginTop: 40, paddingHorizontal: 24 },
  head: { gap: 4 },
  ref: { fontSize: 12.5, fontWeight: "800", color: "#6B7280" },
  title: { fontSize: 20, fontWeight: "800", color: "#111827" },
  pill: { alignSelf: "flex-start", marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: "800" },
  card: { backgroundColor: "#fff", borderRadius: 18, borderWidth: 1, borderColor: "#F3F4F6", padding: 16 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 4 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkText: { fontSize: 13, fontWeight: "800", color: ACCENT },
  muted: { fontSize: 13, color: "#6B7280", marginTop: 4 },
  kv: { flexDirection: "row", gap: 12, paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  k: { width: 110, fontSize: 12.5, fontWeight: "700", color: "#6B7280" },
  v: { flex: 1, fontSize: 14, color: "#111827" },
  label: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#fff",
  },
  multi: { minHeight: 90, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "#E5E7EB" },
  chipSel: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 13, fontWeight: "800", color: "#4B5563" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  actionText: { fontSize: 13.5, fontWeight: "800", color: ACCENT },
  option: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 8,
  },
  optionSel: { borderColor: ACCENT, backgroundColor: "#F9FAFB" },
  optionTitle: { fontSize: 14.5, fontWeight: "800", color: "#111827" },
  optionDesc: { fontSize: 12.5, color: "#6B7280", marginTop: 3, lineHeight: 17 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14, marginBottom: 4 },
  switchText: { flex: 1, fontSize: 14, fontWeight: "700", color: "#111827" },
  task: { borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 12, marginTop: 10 },
  taskTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: "#111827" },
  taskMeta: { fontSize: 12.5, color: "#6B7280", marginTop: 3 },
  taskBody: { fontSize: 13.5, color: "#374151", marginTop: 6, lineHeight: 19 },
  taskRemark: { fontSize: 12.5, color: "#6B7280", marginTop: 4, fontStyle: "italic" },
  iconBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  partsHead: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
  partRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  partName: { fontSize: 14, fontWeight: "700", color: "#111827" },
  partCode: { fontSize: 12, color: "#6B7280" },
  qty: {
    width: 64,
    height: 38,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },
  unit: { width: 28, fontSize: 12, color: "#6B7280" },
  addPart: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, alignSelf: "flex-start" },
  row: { flexDirection: "row", gap: 10 },
  primary: { height: 48, borderRadius: 12, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center", flex: 1.4 },
  primaryDanger: { backgroundColor: "#DC2626" },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  secondary: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 15, fontWeight: "800", color: "#111827" },
  danger: { borderColor: "#FECACA" },
  dangerLabel: { fontSize: 11, fontWeight: "800", color: "#B91C1C", letterSpacing: 1, marginBottom: 10 },
  dangerTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  dangerBody: { fontSize: 13, color: "#4B5563", marginTop: 6, lineHeight: 18 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEF2F2",
  },
  deleteText: { fontSize: 15, fontWeight: "800", color: "#DC2626" },
});
