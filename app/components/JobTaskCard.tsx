import { FontAwesome5 } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { TaskPart } from "../api/client";
import { api } from "../api/client";
import ImagePickerField, { LocalMedia } from "./ImagePicker";
import ImageViewerOverlay from "./ImageViewerOverlay";

export type TaskStatus = "pending" | "in_progress" | "blocked" | "done";

export type JobTaskLike = {
  task_id: number;
  task_name: string;
  task_desc: string | null;
  task_status: TaskStatus;
  task_order: number;
  completed_at?: string | null;
};

type Props = {
  task: JobTaskLike;
  jobId: number;
  editable: boolean;
  onUpdated?: () => void;
};

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string; bg: string; icon: string }
> = {
  done: { label: "Done", color: "#16A34A", bg: "#F0FDF4", icon: "check" },
  pending: { label: "Pending", color: "#D97706", bg: "#FFFBEB", icon: "clock" },
  in_progress: { label: "In Progress", color: "#2563EB", bg: "#EFF6FF", icon: "spinner" },
  blocked: { label: "Blocked", color: "#DC2626", bg: "#FEF2F2", icon: "exclamation" },
};

export default function JobTaskCard({ task, jobId, editable, onUpdated }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loadedDetail, setLoadedDetail] = useState(false);

  const [taskParts, setTaskParts] = useState<TaskPart[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);

  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(task.task_desc ?? "");
  const [savingDesc, setSavingDesc] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  const [stagedPhotos, setStagedPhotos] = useState<LocalMedia[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  const conf = STATUS_CONFIG[task.task_status] ?? STATUS_CONFIG.pending;
  const viewerUrls = photoUrls.map((u) => ({ url: u }));

  const loadDetail = async () => {
    setLoadingParts(true);
    setLoadingPhotos(true);
    try {
      const parts = await api.listTaskParts(task.task_id);
      setTaskParts(Array.isArray(parts) ? parts : []);
    } catch {
      setTaskParts([]);
    } finally {
      setLoadingParts(false);
    }

    try {
      const media = await api.listJobMedia(jobId, { taskId: task.task_id });
      const urls = (Array.isArray(media) ? media : [])
        .map((m) => m?.viewUrl ?? null)
        .filter((u): u is string => !!u);
      setPhotoUrls(Array.from(new Set(urls)));
    } catch {
      setPhotoUrls([]);
    } finally {
      setLoadingPhotos(false);
    }

    setLoadedDetail(true);
  };

  const toggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loadedDetail) loadDetail();
  };

  const startEditingDesc = () => {
    setDescDraft(task.task_desc ?? "");
    setEditingDesc(true);
  };

  const saveDesc = () => {
    Alert.alert(
      "Save changes",
      "Save changes to this task's description?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          style: "default",
          onPress: async () => {
            setSavingDesc(true);
            try {
              await api.updateJobTask(task.task_id, {
                task_desc: descDraft.trim() || null,
              });
              setEditingDesc(false);
              onUpdated?.();
            } catch (e: any) {
              Alert.alert("Failed to save", e?.message ?? "Unknown error");
            } finally {
              setSavingDesc(false);
            }
          },
        },
      ],
    );
  };

  const toggleStatus = () => {
    const nextStatus: TaskStatus = task.task_status === "done" ? "pending" : "done";
    Alert.alert(
      nextStatus === "done" ? "Complete this task?" : "Reopen this task?",
      nextStatus === "done"
        ? `This will mark "${task.task_name}" as complete. This confirms the work is finished.`
        : `This will reopen "${task.task_name}" and move it back to pending.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: nextStatus === "done" ? "Complete Task" : "Reopen Task",
          style: "default",
          onPress: async () => {
            setSavingStatus(true);
            try {
              await api.updateJobTask(task.task_id, { task_status: nextStatus });
              onUpdated?.();
            } catch (e: any) {
              Alert.alert("Failed to update", e?.message ?? "Unknown error");
            } finally {
              setSavingStatus(false);
            }
          },
        },
      ],
    );
  };

  const uploadStagedPhotos = () => {
    if (stagedPhotos.length === 0) return;
    Alert.alert(
      "Attach photos",
      `Attach ${stagedPhotos.length} photo${stagedPhotos.length === 1 ? "" : "s"} to this task?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Attach",
          style: "default",
          onPress: async () => {
            setUploadingPhotos(true);
            try {
              for (const m of stagedPhotos) {
                const presign = await api.presignJobMedia(jobId, m.mime_type, {
                  taskId: task.task_id,
                });
                const blob = await (await fetch(m.localUri)).blob();
                const put = await fetch(presign.uploadUrl, {
                  method: "PUT",
                  headers: { "Content-Type": m.mime_type },
                  body: blob,
                });
                if (!put.ok) throw new Error(`Photo upload failed (${put.status})`);
                await api.confirmJobMedia(jobId, {
                  s3_key: presign.s3_key,
                  mime_type: m.mime_type,
                  size_bytes: blob.size,
                  task_id: task.task_id,
                });
              }
              setStagedPhotos([]);
              await loadDetail();
            } catch (e: any) {
              Alert.alert(
                "Failed to attach photos",
                e?.message ?? "Unknown error",
              );
            } finally {
              setUploadingPhotos(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={s.wrap}>
      <Pressable style={s.row} onPress={toggleExpand}>
        <View style={[s.statusDot, { backgroundColor: conf.bg }]}>
          <FontAwesome5 name={conf.icon as any} size={11} color={conf.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.taskName} numberOfLines={expanded ? undefined : 1}>
            {task.task_name}
          </Text>
          <Text style={[s.statusText, { color: conf.color }]}>
            {conf.label}
            {task.completed_at ? ` · ${formatDateTime(task.completed_at)}` : ""}
          </Text>
        </View>
        <FontAwesome5
          name={expanded ? "chevron-up" : "chevron-down"}
          size={12}
          color="#9CA3AF"
        />
      </Pressable>

      {expanded && (
        <View style={s.detail}>
          {/* Description */}
          {editingDesc ? (
            <View style={{ marginBottom: 12 }}>
              <TextInput
                value={descDraft}
                onChangeText={setDescDraft}
                placeholder="Task description…"
                placeholderTextColor="#9CA3AF"
                style={s.textarea}
                multiline
                editable={!savingDesc}
              />
              <View style={s.editRow}>
                <Pressable
                  style={[s.smallBtn, s.smallBtnGhost]}
                  onPress={() => setEditingDesc(false)}
                  disabled={savingDesc}
                >
                  <Text style={s.smallBtnGhostText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[s.smallBtn, s.smallBtnDark]}
                  onPress={saveDesc}
                  disabled={savingDesc}
                >
                  <Text style={s.smallBtnDarkText}>
                    {savingDesc ? "Saving…" : "Save"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={{ marginBottom: 12 }}>
              <View style={s.detailHeaderRow}>
                <Text style={s.detailLabel}>DESCRIPTION</Text>
                {editable && (
                  <Pressable
                    onPress={startEditingDesc}
                    hitSlop={8}
                    style={s.editBtn}
                  >
                    <FontAwesome5 name="pen" size={10} color="#374151" />
                    <Text style={s.editBtnText}>Edit</Text>
                  </Pressable>
                )}
              </View>
              <Text style={s.detailValue}>
                {task.task_desc || "No description added."}
              </Text>
            </View>
          )}

          {/* Parts used */}
          <View style={{ marginBottom: 12 }}>
            <Text style={s.detailLabel}>PARTS USED</Text>
            {loadingParts ? (
              <Text style={s.mutedText}>Loading parts…</Text>
            ) : taskParts.length === 0 ? (
              <Text style={s.mutedText}>No parts recorded.</Text>
            ) : (
              taskParts.map((p) => (
                <View key={p.part_id} style={s.partRow}>
                  <Text style={s.partName}>
                    {p.part_name} <Text style={s.partCode}>({p.part_code})</Text>
                  </Text>
                  <Text style={s.partQty}>×{p.qty}</Text>
                </View>
              ))
            )}
          </View>

          {/* Photos */}
          <View style={{ marginBottom: editable ? 12 : 0 }}>
            <View style={s.detailHeaderRow}>
              <Text style={s.detailLabel}>PHOTOS</Text>
              <View style={s.countPill}>
                <Text style={s.countPillText}>
                  {photoUrls.length} photo{photoUrls.length === 1 ? "" : "s"}
                </Text>
              </View>
            </View>
            {loadingPhotos ? (
              <Text style={s.mutedText}>Loading photos…</Text>
            ) : photoUrls.length === 0 ? (
              <Text style={s.mutedText}>No photos attached.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingBottom: 2 }}
              >
                {photoUrls.map((uri, idx) => (
                  <Pressable
                    key={`${uri}-${idx}`}
                    onPress={() => {
                      setViewerIndex(idx);
                      setViewerVisible(true);
                    }}
                    style={s.thumb}
                  >
                    <Image source={{ uri }} style={s.thumbImg} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>

          {editable && (
            <>
              <ImagePickerField
                title="Add Photo"
                value={stagedPhotos}
                onChange={setStagedPhotos}
                captureLabel="Capture Photo"
                uploadLabel="Upload Photo"
                showUploadButton
              />
              {stagedPhotos.length > 0 && (
                <Pressable
                  style={[s.smallBtn, s.smallBtnDark, { marginTop: 10 }]}
                  onPress={uploadStagedPhotos}
                  disabled={uploadingPhotos}
                >
                  {uploadingPhotos ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={s.smallBtnDarkText}>
                      Attach {stagedPhotos.length} Photo
                      {stagedPhotos.length === 1 ? "" : "s"}
                    </Text>
                  )}
                </Pressable>
              )}

              <Pressable
                style={[
                  s.smallBtn,
                  task.task_status === "done" ? s.smallBtnOutlineAmber : s.smallBtnGreen,
                  { marginTop: 10, flexDirection: "row", gap: 8 },
                ]}
                onPress={toggleStatus}
                disabled={savingStatus}
              >
                {savingStatus ? (
                  <ActivityIndicator
                    size="small"
                    color={task.task_status === "done" ? "#D97706" : "#fff"}
                  />
                ) : (
                  <>
                    <FontAwesome5
                      name={task.task_status === "done" ? "undo" : "check-circle"}
                      size={13}
                      color={task.task_status === "done" ? "#D97706" : "#fff"}
                    />
                    <Text
                      style={
                        task.task_status === "done"
                          ? s.smallBtnOutlineAmberText
                          : s.smallBtnGreenText
                      }
                    >
                      {task.task_status === "done"
                        ? "Reopen Task"
                        : "Complete Task"}
                    </Text>
                  </>
                )}
              </Pressable>
            </>
          )}
        </View>
      )}

      <ImageViewerOverlay
        visible={viewerVisible}
        imageUrls={viewerUrls}
        startIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
    marginBottom: 10,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  statusDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  taskName: { fontSize: 14, fontWeight: "700", color: "#111827" },
  statusText: { fontSize: 12, fontWeight: "600", marginTop: 2 },

  detail: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
    paddingTop: 12,
  },
  detailHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.8,
  },
  detailValue: { fontSize: 14, color: "#111827", fontWeight: "500", lineHeight: 20 },
  mutedText: { fontSize: 13, color: "#9CA3AF", fontWeight: "500" },

  partRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#F9FAFB",
  },
  partName: { fontSize: 13, fontWeight: "600", color: "#111827", flex: 1 },
  partCode: { fontWeight: "500", color: "#6B7280" },
  partQty: { fontSize: 13, fontWeight: "700", color: "#374151" },

  countPill: {
    backgroundColor: "#F3F4F6",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countPillText: { fontSize: 11, fontWeight: "600", color: "#6B7280" },

  thumb: { width: 72, height: 72, borderRadius: 10, overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },

  textarea: {
    minHeight: 70,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 10,
    textAlignVertical: "top",
  },
  editRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  smallBtn: {
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    flex: 1,
  },
  smallBtnDark: { backgroundColor: "#111827" },
  smallBtnDarkText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  smallBtnGhost: { borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  smallBtnGhostText: { color: "#374151", fontSize: 13, fontWeight: "700" },
  smallBtnGreen: { backgroundColor: "#16A34A" },
  smallBtnGreenText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  smallBtnOutlineAmber: {
    borderWidth: 1,
    borderColor: "#D97706",
    backgroundColor: "#FFFBEB",
  },
  smallBtnOutlineAmberText: { color: "#D97706", fontSize: 13, fontWeight: "700" },

  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  editBtnText: { fontSize: 12, fontWeight: "700", color: "#374151" },
});
