import { FontAwesome5 } from "@expo/vector-icons";
import PhotoStrip from "../PhotoStrip";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { JobFollowup, JobOrderEntry, JobPerson } from "../../api/client";
import { useI18n } from "../../i18n/i18n-ctx";
import Sheet from "../Sheet";
import { KEYBOARD_DONE_ID } from "@/components/KeyboardDone";

type Priority = JobOrderEntry["priority"];
const PRIORITIES: { key: Priority; color: string; bg: string }[] = [
  { key: "low", color: "#15803D", bg: "#DCFCE7" },
  { key: "medium", color: "#B45309", bg: "#FEF3C7" },
  { key: "high", color: "#C2410C", bg: "#FFEDD5" },
  { key: "critical", color: "#B91C1C", bg: "#FEE2E2" },
];

type Draft = { issue: string; action: string; priority: Priority | null; remarks: string };

/**
 * C9 · Approve step 1: a job order for every pending follow-up, all
 * compulsory. Issue and action are pre-filled and editable; priority has no
 * default; remarks are optional. Nothing is saved here: Next opens the
 * sign-off, and only Sign & approve sends it all in one request.
 */
export function IssueJobOrdersSheet({
  visible,
  followups,
  busLabel,
  initial,
  onClose,
  onNext,
}: {
  visible: boolean;
  followups: JobFollowup[];
  busLabel: string;
  /** Kept when the sign-off is cancelled and step 1 reopens. */
  initial: JobOrderEntry[] | null;
  onClose: () => void;
  onNext: (entries: JobOrderEntry[]) => void;
}) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});

  useEffect(() => {
    if (!visible) return;
    const next: Record<number, Draft> = {};
    for (const f of followups) {
      const kept = initial?.find((e) => e.followup_id === f.followup_id);
      next[f.followup_id] = kept
        ? { issue: kept.issue, action: kept.required_action, priority: kept.priority, remarks: kept.remarks ?? "" }
        : { issue: f.issue, action: f.required_action, priority: null, remarks: "" };
    }
    setDrafts(next);
  }, [visible, followups, initial]);

  const ready = followups.every((f) => {
    const d = drafts[f.followup_id];
    return d && d.priority && d.issue.trim() && d.action.trim();
  });

  const set = (id: number, patch: Partial<Draft>) => setDrafts((x) => ({ ...x, [id]: { ...x[id], ...patch } }));

  return (
    <Sheet
      visible={visible}
      title={t("job2.review.step1Title")}
      subtitle={t("job2.review.step1Header")}
      onClose={onClose}
      tall
      footer={
        <View>
          <Text style={s.footerNote}>{t("job2.review.footer")}</Text>
          <Pressable
            style={[s.primary, !ready && { opacity: 0.45 }]}
            disabled={!ready}
            onPress={() =>
              onNext(
                followups.map((f) => {
                  const d = drafts[f.followup_id];
                  return {
                    followup_id: f.followup_id,
                    issue: d.issue.trim(),
                    required_action: d.action.trim(),
                    priority: d.priority as Priority,
                    remarks: d.remarks.trim() || null,
                  };
                }),
              )
            }
          >
            <Text style={s.primaryText}>{t("job2.review.next")}</Text>
          </Pressable>
        </View>
      }
    >
      <Text style={s.line}>{t("job2.review.step1Line")}</Text>
      {followups.map((f, i) => {
        const d = drafts[f.followup_id];
        if (!d) return null;
        return (
          <View key={f.followup_id} style={s.section}>
            <Text style={s.sectionTitle}>{t("job2.review.followUpNofM", { n: i + 1, m: followups.length })}</Text>

            <Text style={s.label}>{t("job2.followups.issue")} *</Text>
            <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
              value={d.issue}
              onChangeText={(v) => set(f.followup_id, { issue: v })}
              style={s.input}
              multiline
              maxLength={300}
            />
            <Text style={s.label}>{t("job2.followups.action")} *</Text>
            <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
              value={d.action}
              onChangeText={(v) => set(f.followup_id, { action: v })}
              style={s.input}
              multiline
              maxLength={300}
            />

            <Text style={s.label}>{t("job2.review.bus")}</Text>
            <Text style={s.fixed}>{busLabel}</Text>

            {f.photos.length > 0 && <PhotoStrip urls={f.photos.map((p) => p.url)} size={64} style={{ marginTop: 8 }} />}

            <Text style={s.label}>{t("job2.review.priority")} *</Text>
            <View style={s.prioRow}>
              {PRIORITIES.map((p) => {
                const on = d.priority === p.key;
                return (
                  <Pressable
                    key={p.key}
                    style={[s.prio, on && { backgroundColor: p.bg, borderColor: p.color }]}
                    onPress={() => set(f.followup_id, { priority: p.key })}
                  >
                    <Text style={[s.prioText, on && { color: p.color }]}>{t(`statusBadge.${p.key}`)}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={s.label}>{t("job2.review.remarks")}</Text>
            <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
              value={d.remarks}
              onChangeText={(v) => set(f.followup_id, { remarks: v })}
              placeholder={t("job2.review.remarksPlaceholder")}
              placeholderTextColor="#9CA3AF"
              style={s.input}
              multiline
              maxLength={300}
            />
          </View>
        );
      })}
    </Sheet>
  );
}

/** C12 · Send back: a reason (required, 300), then the sign-off. */
export function SendBackSheet({
  visible,
  technician,
  onClose,
  onNext,
}: {
  visible: boolean;
  technician: JobPerson | null;
  onClose: () => void;
  onNext: (reason: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (visible) setReason("");
  }, [visible]);
  const trimmed = reason.trim();

  return (
    <Sheet
      visible={visible}
      title={t("job2.review.sendBackTitle")}
      onClose={onClose}
      footer={
        <View style={s.row}>
          <Pressable style={s.secondary} onPress={onClose}>
            <Text style={s.secondaryText}>{t("common.cancel")}</Text>
          </Pressable>
          <Pressable
            style={[s.primary, s.danger, { flex: 1.4, marginTop: 0 }, !trimmed && { opacity: 0.45 }]}
            disabled={!trimmed}
            onPress={() => onNext(trimmed)}
          >
            <FontAwesome5 name="undo" size={13} color="#fff" />
            <Text style={s.primaryText}>{t("job2.review.sendBack")}</Text>
          </Pressable>
        </View>
      }
    >
      <Text style={s.label}>{t("job2.review.goesBackTo")}</Text>
      <Text style={s.fixed}>
        {technician?.name ?? "—"}
        {technician?.username ? `  @${technician.username}` : ""}
      </Text>
      <Text style={s.label}>{t("job2.review.reason")} *</Text>
      <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
        value={reason}
        onChangeText={setReason}
        placeholder={t("job2.review.reasonPlaceholder")}
        placeholderTextColor="#9CA3AF"
        style={[s.input, { minHeight: 90 }]}
        multiline
        maxLength={300}
      />
      <Text style={s.counter}>{trimmed.length} / 300</Text>
      <View style={s.info}>
        <FontAwesome5 name="info-circle" size={13} color="#2563EB" />
        <Text style={s.infoText}>{t("job2.review.sendBackInfo")}</Text>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  line: { fontSize: 13, color: "#4B5563", marginBottom: 6, lineHeight: 18 },
  section: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 14, padding: 12, marginTop: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  label: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: "#111827",
    minHeight: 48,
    textAlignVertical: "top",
  },
  fixed: { fontSize: 14, fontWeight: "700", color: "#374151" },
  prioRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  prio: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "#E5E7EB" },
  prioText: { fontSize: 13, fontWeight: "800", color: "#4B5563" },
  footerNote: { fontSize: 12, color: "#6B7280", marginBottom: 8, lineHeight: 16 },
  row: { flexDirection: "row", gap: 10 },
  primary: {
    marginTop: 4,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#34873F",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  danger: { backgroundColor: "#DC2626" },
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
  counter: { fontSize: 12, color: "#6B7280", textAlign: "right", marginTop: 4 },
  info: { flexDirection: "row", gap: 8, marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: "#EFF6FF" },
  infoText: { flex: 1, fontSize: 12.5, color: "#1E3A8A", lineHeight: 17 },
});
