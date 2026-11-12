import { FontAwesome5 } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { isWholeUnit, type PartUnit, type TaskJobType } from "../api/client";
import { useI18n } from "../i18n/i18n-ctx";
import type { BusSystemKey } from "../utils/busSystems";
import BusSystemPicker from "./BusSystemPicker";
import ImagePickerField, { type LocalMedia } from "./ImagePicker";

// One task being written, before it is saved. Used by the technician's job
// screen ("Add task") and by Job Order Registration, so both ask for the same
// record: issue, work done, parts (or "no parts used"), an optional
// follow-up/remark, and at least one completion photo. That record is what the
// Job Completion Report prints.
export type TaskDraft = {
  // Repair (fix a fault) or Maintenance (scheduled service).
  jobType: TaskJobType | null;
  // One of the 29 bus system categories.
  category: BusSystemKey | null;
  // The issue found. Repairs only: a maintenance task has none.
  issue: string;
  workDone: string;
  remark: string;
  // part_id → quantity
  parts: Record<number, number>;
  noParts: boolean;
  photos: LocalMedia[];
};

export const emptyTaskDraft = (): TaskDraft => ({
  jobType: null,
  category: null,
  issue: "",
  workDone: "",
  remark: "",
  parts: {},
  noParts: false,
  photos: [],
});

export type TaskPartOption = {
  part_id: number;
  part_name: string;
  part_code: string;
  part_brand?: string | null;
  part_unit?: PartUnit | null;
  part_stock?: number | null;
};

const partCount = (d: TaskDraft) => Object.values(d.parts).filter((q) => q > 0).length;

/** The first thing missing from a task, as a message; null when complete. */
export function taskDraftProblem(d: TaskDraft, t: (k: string) => string): string | null {
  if (!d.jobType) return t("taskEditor.needJobType");
  if (!d.category) return t("taskEditor.needCategory");
  if (d.jobType === "repair" && !d.issue.trim()) return t("taskEditor.needIssue");
  if (!d.workDone.trim()) return t("taskEditor.needWorkDone");
  if (!d.noParts && partCount(d) === 0) return t("taskEditor.needParts");
  if (d.photos.length === 0) return t("taskEditor.needPhoto");
  return null;
}

/**
 * The task_name to send: the issue found for a repair. A maintenance task has
 * no issue, so this is null and the server names it "Maintenance · <category>"
 * (in English, matching the Job Completion Report).
 */
export function taskNameFor(d: TaskDraft): string | null {
  return d.jobType === "maintenance" ? null : d.issue.trim();
}

/** Work-done text as numbered steps: one per line, a leading "-" dropped. */
export function workDoneSteps(text: string): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

type Props = {
  index: number;
  value: TaskDraft;
  onChange: (next: TaskDraft) => void;
  parts: TaskPartOption[];
  loadingParts?: boolean;
  // Locked (e.g. odometer not recorded yet): every input calls onLockedPress.
  locked?: boolean;
  onLockedPress?: () => void;
  disabled?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onDelete?: () => void;
  // The button at the bottom ("Add Task"). Omit to hide it.
  confirmLabel?: string;
  onConfirm?: () => void;
  saving?: boolean;
  accent?: string;
};

export default function TaskEditorCard({
  index,
  value,
  onChange,
  parts,
  loadingParts,
  locked,
  onLockedPress,
  disabled,
  collapsed,
  onToggleCollapsed,
  onDelete,
  confirmLabel,
  onConfirm,
  saving,
  accent = "#C4501A",
}: Props) {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const problem = taskDraftProblem(value, t);
  const editable = !locked && !disabled;
  const guard = (fn: () => void) => () => (locked ? onLockedPress?.() : fn());
  const set = (patch: Partial<TaskDraft>) => onChange({ ...value, ...patch });

  const partsById = useMemo(() => {
    const m = new Map<number, TaskPartOption>();
    for (const p of parts) m.set(p.part_id, p);
    return m;
  }, [parts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? parts.filter((p) =>
          [p.part_name, p.part_code, p.part_brand].some((x) => String(x ?? "").toLowerCase().includes(q)),
        )
      : parts;
    return list.slice(0, 50);
  }, [parts, search]);

  const selectedIds = Object.keys(value.parts)
    .map(Number)
    .filter((id) => (value.parts[id] ?? 0) > 0);

  const step = (id: number) => (isWholeUnit(partsById.get(id)?.part_unit) ? 1 : 0.5);

  const addPart = (id: number) => {
    set({ parts: { ...value.parts, [id]: (value.parts[id] ?? 0) + step(id) }, noParts: false });
  };
  const changeQty = (id: number, dir: 1 | -1) => {
    const next = Math.round(((value.parts[id] ?? 0) + dir * step(id)) * 100) / 100;
    const copy = { ...value.parts };
    if (next <= 0) delete copy[id];
    else copy[id] = next;
    set({ parts: copy });
  };
  const removePart = (id: number) => {
    const copy = { ...value.parts };
    delete copy[id];
    set({ parts: copy });
  };

  const steps = workDoneSteps(value.workDone);

  return (
    <View style={s.card}>
      {/* Header: number, title, status, delete, collapse */}
      <Pressable style={s.header} onPress={onToggleCollapsed} disabled={!onToggleCollapsed}>
        <View style={[s.num, { backgroundColor: `${accent}1A` }]}>
          <Text style={[s.numText, { color: accent }]}>{index}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>
            {t("taskEditor.taskN", { n: index })}
            {value.jobType ? (
              <Text style={s.titleType}>{` · ${t(`taskEditor.type_${value.jobType}`)}`}</Text>
            ) : null}
            {collapsed && value.jobType === "repair" && value.issue.trim() ? (
              <Text style={s.titleType}>{` · ${value.issue.trim()}`}</Text>
            ) : null}
          </Text>
          <Text style={[s.status, problem ? s.statusTodo : s.statusDone]}>
            {problem ? t("taskEditor.incomplete") : t("taskEditor.allComplete")}
          </Text>
        </View>
        {onDelete && (
          <Pressable onPress={onDelete} hitSlop={10} style={s.iconBtn} disabled={disabled}>
            <FontAwesome5 name="trash-alt" size={14} color="#6B7280" />
          </Pressable>
        )}
        {onToggleCollapsed && (
          <FontAwesome5 name={collapsed ? "chevron-down" : "chevron-up"} size={13} color="#374151" />
        )}
      </Pressable>

      {!collapsed && (
        <View style={s.body}>
          <Text style={s.label}>
            {t("taskEditor.jobType")} <Text style={s.req}>*</Text>
          </Text>
          <View style={s.typeRow}>
            {(["repair", "maintenance"] as TaskJobType[]).map((jt) => {
              const active = value.jobType === jt;
              return (
                <Pressable
                  key={jt}
                  onPress={guard(() => set({ jobType: jt }))}
                  disabled={disabled}
                  style={[s.typeCard, active && { borderColor: accent, backgroundColor: `${accent}0F` }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  {active && (
                    <View style={[s.typeCheck, { backgroundColor: accent }]}>
                      <FontAwesome5 name="check" size={9} color="#fff" />
                    </View>
                  )}
                  <View style={[s.typeIcon, { backgroundColor: active ? "#fff" : "#F3F4F6" }]}>
                    <FontAwesome5
                      name={jt === "repair" ? "wrench" : "calendar-check"}
                      size={15}
                      color={active ? accent : "#4B5563"}
                    />
                  </View>
                  <Text style={s.typeTitle}>{t(`taskEditor.type_${jt}`)}</Text>
                  <Text style={s.typeSub}>{t(`taskEditor.type_${jt}_sub`)}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={s.label}>
            {t("taskEditor.category")} <Text style={s.req}>*</Text>
          </Text>
          <BusSystemPicker
            value={value.category}
            onChange={(category) => set({ category })}
            disabled={disabled}
            onLockedPress={locked ? onLockedPress : undefined}
            accent={accent}
          />

          {value.jobType !== "maintenance" && (
            <>
              <View style={s.rowBetween}>
                <Text style={s.label}>
                  {t("taskEditor.issue")} <Text style={s.req}>*</Text>
                </Text>
                <Text style={s.labelHint}>{t("taskEditor.repairOnly")}</Text>
              </View>
              <TextInput
                value={value.issue}
                onChangeText={(v) => set({ issue: v })}
                placeholder={t("jobDetail.taskIssuePlaceholder")}
                placeholderTextColor="#9CA3AF"
                style={[s.input, s.multi]}
                multiline
                editable={editable}
                onFocus={() => locked && onLockedPress?.()}
              />
            </>
          )}

          <Text style={s.label}>
            {t("taskEditor.workDone")} <Text style={s.req}>*</Text>
          </Text>
          <TextInput
            value={value.workDone}
            onChangeText={(v) => set({ workDone: v })}
            placeholder={t("taskEditor.workDonePlaceholder")}
            placeholderTextColor="#9CA3AF"
            style={[s.input, s.multi, { minHeight: 96 }]}
            multiline
            editable={editable}
            onFocus={() => locked && onLockedPress?.()}
          />
          <Text style={s.hint}>{t("taskEditor.workDoneHint")}</Text>
          {steps.length > 1 && (
            <View style={s.preview}>
              {steps.map((st, i) => (
                <Text key={i} style={s.previewLine}>{`${i + 1}. ${st}`}</Text>
              ))}
            </View>
          )}

          {/* Parts */}
          <View style={s.rowBetween}>
            <Text style={s.label}>
              {t("taskEditor.partsUsed")} <Text style={s.req}>*</Text>
            </Text>
            {selectedIds.length > 0 && (
              <View style={s.pill}>
                <Text style={s.pillText}>{t("taskEditor.partsCount", { count: selectedIds.length })}</Text>
              </View>
            )}
          </View>

          {selectedIds.map((id) => {
            const p = partsById.get(id);
            const qty = value.parts[id] ?? 0;
            return (
              <View key={id} style={s.partRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.partName}>{p?.part_name ?? `#${id}`}</Text>
                  <Text style={s.partMeta}>
                    {[p?.part_code, p?.part_brand].filter(Boolean).join(" · ") || "—"}
                  </Text>
                </View>
                <View style={s.stepper}>
                  <Pressable style={s.stepBtn} onPress={guard(() => changeQty(id, -1))} disabled={disabled}>
                    <Text style={s.stepText}>−</Text>
                  </Pressable>
                  <Text style={s.qty}>
                    {qty}
                    {p?.part_unit && p.part_unit !== "pc" ? ` ${p.part_unit}` : ""}
                  </Text>
                  <Pressable style={s.stepBtn} onPress={guard(() => changeQty(id, 1))} disabled={disabled}>
                    <Text style={s.stepText}>+</Text>
                  </Pressable>
                </View>
                <Pressable onPress={guard(() => removePart(id))} hitSlop={8} style={s.iconBtn} disabled={disabled}>
                  <FontAwesome5 name="times" size={14} color="#6B7280" />
                </Pressable>
              </View>
            );
          })}

          {!value.noParts && (
            <Pressable
              style={[s.addPart, { borderColor: `${accent}66` }, !editable && { opacity: 0.6 }]}
              onPress={guard(() => setPickerOpen((v) => !v))}
              disabled={disabled}
            >
              <FontAwesome5 name="plus" size={12} color={accent} />
              <Text style={[s.addPartText, { color: accent }]}>
                {loadingParts ? t("taskEditor.loadingParts") : t("taskEditor.addPart")}
              </Text>
              <FontAwesome5 name={pickerOpen ? "chevron-up" : "chevron-down"} size={11} color="#6B7280" />
            </Pressable>
          )}

          {pickerOpen && !value.noParts && (
            <View style={s.picker}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t("partsUsed.searchByNameOrCode")}
                placeholderTextColor="#9CA3AF"
                style={s.input}
                autoCorrect={false}
              />
              <ScrollView style={{ maxHeight: 240, marginTop: 8 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {filtered.length === 0 ? (
                  <Text style={s.muted}>{loadingParts ? t("taskEditor.loadingParts") : t("partsUsed.noPartsFound")}</Text>
                ) : (
                  filtered.map((p) => {
                    const q = value.parts[p.part_id] ?? 0;
                    return (
                      <Pressable
                        key={p.part_id}
                        style={[s.pickItem, q > 0 && { backgroundColor: `${accent}14` }]}
                        onPress={() => addPart(p.part_id)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={s.partName}>{p.part_name}</Text>
                          <Text style={s.partMeta}>
                            {[p.part_code, p.part_brand, `${t("taskEditor.stock")}: ${p.part_stock ?? 0}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        </View>
                        {q > 0 && (
                          <Text style={[s.pickQty, { color: accent }]}>×{q}</Text>
                        )}
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </View>
          )}

          <Pressable
            style={s.checkRow}
            onPress={guard(() => {
              const noParts = !value.noParts;
              set({ noParts, parts: noParts ? {} : value.parts });
              if (noParts) setPickerOpen(false);
            })}
            disabled={disabled}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: value.noParts }}
          >
            <View style={[s.checkbox, value.noParts && { backgroundColor: accent, borderColor: accent }]}>
              {value.noParts && <FontAwesome5 name="check" size={10} color="#fff" />}
            </View>
            <Text style={s.checkText}>{t("taskEditor.noParts")}</Text>
          </Pressable>

          <Text style={s.label}>{t("taskEditor.remark")}</Text>
          <TextInput
            value={value.remark}
            onChangeText={(v) => set({ remark: v })}
            placeholder={t("taskEditor.remarkPlaceholder")}
            placeholderTextColor="#9CA3AF"
            style={[s.input, s.multi]}
            multiline
            editable={editable}
            onFocus={() => locked && onLockedPress?.()}
          />

          <View style={{ marginTop: 14 }}>
            <Pressable onPress={locked ? onLockedPress : undefined} disabled={!locked}>
              <ImagePickerField
                title={t("taskEditor.completionPhotos")}
                required
                value={value.photos}
                onChange={(photos) => set({ photos })}
                showUploadButton
                readOnly={!editable}
              />
            </Pressable>
          </View>

          {confirmLabel && onConfirm && (
            <Pressable
              style={[s.confirm, { backgroundColor: accent }, (saving || locked || disabled) && { opacity: 0.6 }]}
              onPress={guard(onConfirm)}
              disabled={saving || disabled}
            >
              <FontAwesome5 name="check" size={13} color="#fff" />
              <Text style={s.confirmText}>{saving ? t("common.saving") : confirmLabel}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 18,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  num: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  numText: { fontSize: 15, fontWeight: "800" },
  title: { fontSize: 16, fontWeight: "800", color: "#111827" },
  titleType: { fontWeight: "600", color: "#6B7280" },
  labelHint: { fontSize: 12, color: "#9CA3AF", marginTop: 8 },
  typeRow: { flexDirection: "row", gap: 10 },
  typeCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 16,
    padding: 12,
    backgroundColor: "#fff",
  },
  typeCheck: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  typeIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  typeTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  typeSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  status: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  statusDone: { color: "#16A34A" },
  statusTodo: { color: "#B45309" },
  iconBtn: { padding: 6 },
  body: { paddingHorizontal: 14, paddingBottom: 16, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6B7280",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 8,
  },
  req: { color: "#DC2626" },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#fff",
  },
  multi: { minHeight: 56, textAlignVertical: "top" },
  hint: { fontSize: 12, color: "#6B7280", marginTop: 6 },
  preview: { marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: "#F9FAFB", gap: 2 },
  previewLine: { fontSize: 13, color: "#374151" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pill: { backgroundColor: "#F3F4F6", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, marginTop: 8 },
  pillText: { fontSize: 11, fontWeight: "700", color: "#374151" },
  partRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  partName: { fontSize: 14, fontWeight: "700", color: "#111827" },
  partMeta: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 999,
  },
  stepBtn: { paddingHorizontal: 11, paddingVertical: 5 },
  stepText: { fontSize: 18, fontWeight: "700", color: "#111827" },
  qty: { minWidth: 28, textAlign: "center", fontSize: 14, fontWeight: "700", color: "#111827" },
  addPart: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  addPartText: { flex: 1, fontSize: 14, fontWeight: "700" },
  picker: { marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: "#F9FAFB" },
  pickItem: { flexDirection: "row", alignItems: "center", paddingVertical: 9, paddingHorizontal: 8, borderRadius: 10 },
  pickQty: { fontSize: 13, fontWeight: "800" },
  muted: { fontSize: 13, color: "#6B7280", paddingVertical: 8 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#9CA3AF",
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { fontSize: 14, color: "#374151" },
  confirm: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 14,
  },
  confirmText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
