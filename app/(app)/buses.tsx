import { FontAwesome5 } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { Card, CardContent } from "../components/card";

type Bus = {
  bus_id: string | number;
  bus_route?: string | null;
  bus_model?: string | null;
  project_id?: string | null;
};

type BusForm = {
  bus_id: string;
  bus_route: string;
  bus_model: string;
  project_id: string;
};

type Project = { project_id: string; project_name: string };

const EMPTY_FORM: BusForm = { bus_id: "", bus_route: "", bus_model: "", project_id: "" };

function busToForm(b: Bus): BusForm {
  return {
    bus_id: String(b.bus_id ?? ""),
    bus_route: b.bus_route ?? "",
    bus_model: b.bus_model ?? "",
    project_id: b.project_id ?? "",
  };
}

export default function BusesScreen() {
  const [buses, setBuses] = useState<Bus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // null = add mode, Bus = edit mode
  const [editingBus, setEditingBus] = useState<Bus | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<BusForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // project picker
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectPickerVisible, setProjectPickerVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.buses();
      setBuses(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load buses.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const loadProjects = async () => {
    setProjectsLoading(true);
    try {
      const data = await api.projects();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const filtered = buses.filter((b) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      String(b.bus_id).toLowerCase().includes(q) ||
      (b.bus_route ?? "").toLowerCase().includes(q) ||
      (b.bus_model ?? "").toLowerCase().includes(q) ||
      (b.project_id ?? "").toLowerCase().includes(q)
    );
  });

  const openAddModal = () => {
    setEditingBus(null);
    setForm(EMPTY_FORM);
    setModalVisible(true);
    loadProjects();
  };

  const openEditModal = (bus: Bus) => {
    setEditingBus(bus);
    setForm(busToForm(bus));
    setModalVisible(true);
    loadProjects();
  };

  const closeModal = () => {
    if (submitting) return;
    setModalVisible(false);
    setEditingBus(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async () => {
    if (!form.bus_id.trim()) {
      Alert.alert("Validation", "Bus ID is required.");
      return;
    }

    try {
      setSubmitting(true);
      if (editingBus) {
        await api.updateBus(editingBus.bus_id, {
          bus_id: form.bus_id.trim(),
          bus_route: form.bus_route.trim() || undefined,
          bus_model: form.bus_model.trim() || undefined,
          project_id: form.project_id.trim() || undefined,
        });
      } else {
        await api.createBus({
          bus_id: form.bus_id.trim(),
          bus_route: form.bus_route.trim() || undefined,
          bus_model: form.bus_model.trim() || undefined,
          project_id: form.project_id.trim() || undefined,
        });
      }
      closeModal();
      setLoading(true);
      load();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? (editingBus ? "Failed to update bus." : "Failed to add bus."));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedProject = projects.find((p) => p.project_id === form.project_id);

  const renderBus = ({ item }: { item: Bus }) => (
    <Card style={styles.busCard}>
      <CardContent style={styles.busCardContent}>
        <View style={styles.busIconWrap}>
          <FontAwesome5 name="bus" size={20} color="#111827" />
        </View>
        <View style={styles.busTextCol}>
          <Text style={styles.busRego}>{item.bus_id}</Text>
          <Text style={styles.busMeta}>
            {[
              item.bus_route && `Route: ${item.bus_route}`,
              item.bus_model && `Model: ${item.bus_model}`,
              item.project_id && `Project: ${item.project_id}`,
            ]
              .filter(Boolean)
              .join("  •  ") || "No additional details"}
          </Text>
        </View>
        <View style={styles.busRight}>
          <Text style={styles.busId}>#{item.bus_id}</Text>
          <View style={styles.busActions}>
            <Pressable style={styles.editButton} onPress={() => openEditModal(item)}>
              <FontAwesome5 name="pen" size={13} color="#6B7280" />
            </Pressable>
          </View>
        </View>
      </CardContent>
    </Card>
  );

  const isEditMode = editingBus !== null;

  return (
    <SafeAreaView style={styles.page} edges={["bottom"]}>
      {/* Search + Add */}
      <View style={styles.header}>
        <View style={styles.searchBox}>
          <FontAwesome5 name="search" size={13} color="#9CA3AF" style={{ marginRight: 8 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search buses..."
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
        <Pressable style={styles.addButton} onPress={openAddModal}>
          <FontAwesome5 name="plus" size={14} color="#fff" />
          <Text style={styles.addButtonText}>Add Bus</Text>
        </Pressable>
      </View>

      {/* Error */}
      {!!error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading buses...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.bus_id)}
          renderItem={renderBus}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No buses found</Text>
              <Text style={styles.emptySub}>
                {buses.length === 0 ? "No buses in the database yet." : "Try clearing your search."}
              </Text>
            </View>
          }
        />
      )}

      {/* Add / Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={styles.modalKeyboardView}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isEditMode ? `Edit Bus #${editingBus!.bus_id}` : "Add New Bus"}
              </Text>
              <Pressable onPress={closeModal} style={styles.modalClose}>
                <FontAwesome5 name="times" size={16} color="#6B7280" />
              </Pressable>
            </View>

            <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                Registration <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={[styles.input, isEditMode && styles.inputReadOnly]}
                value={form.bus_id}
                onChangeText={(v) => setForm((f) => ({ ...f, bus_id: v }))}
                placeholder="e.g. ABC 1234"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="characters"
                editable={!submitting && !isEditMode}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Route</Text>
              <TextInput
                style={styles.input}
                value={form.bus_route}
                onChangeText={(v) => setForm((f) => ({ ...f, bus_route: v }))}
                placeholder="e.g. Route 12"
                placeholderTextColor="#9CA3AF"
                editable={!submitting}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Model</Text>
              <TextInput
                style={styles.input}
                value={form.bus_model}
                onChangeText={(v) => setForm((f) => ({ ...f, bus_model: v }))}
                placeholder="e.g. Volvo B8RLE"
                placeholderTextColor="#9CA3AF"
                editable={!submitting}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Project</Text>
              <Pressable
                style={[styles.input, styles.pickerButton, submitting && { opacity: 0.55 }]}
                onPress={() => !submitting && setProjectPickerVisible((v) => !v)}
              >
                <Text style={form.project_id ? styles.pickerText : styles.pickerPlaceholder}>
                  {selectedProject
                    ? `${selectedProject.project_name} (${selectedProject.project_id})`
                    : "Select a project..."}
                </Text>
                <FontAwesome5
                  name={projectPickerVisible ? "chevron-up" : "chevron-down"}
                  size={12}
                  color="#9CA3AF"
                />
              </Pressable>

              {projectPickerVisible && (
                <View style={styles.inlinePickerList}>
                  {projectsLoading ? (
                    <View style={styles.pickerCenter}>
                      <ActivityIndicator size="small" />
                    </View>
                  ) : projects.length === 0 ? (
                    <View style={styles.pickerCenter}>
                      <Text style={styles.emptySub}>No projects found.</Text>
                    </View>
                  ) : (
                    <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }}>
                      <Pressable
                        style={[styles.projectRow, !form.project_id && styles.projectRowSelected]}
                        onPress={() => {
                          setForm((f) => ({ ...f, project_id: "" }));
                          setProjectPickerVisible(false);
                        }}
                      >
                        <Text style={[styles.projectName, !form.project_id && styles.projectNameSelected]}>
                          None
                        </Text>
                      </Pressable>
                      {projects.map((p) => {
                        const selected = form.project_id === p.project_id;
                        return (
                          <Pressable
                            key={p.project_id}
                            style={[styles.projectRow, selected && styles.projectRowSelected]}
                            onPress={() => {
                              setForm((f) => ({ ...f, project_id: p.project_id }));
                              setProjectPickerVisible(false);
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.projectName, selected && styles.projectNameSelected]}>
                                {p.project_name}
                              </Text>
                              <Text style={styles.projectId}>{p.project_id}</Text>
                            </View>
                            {selected && <FontAwesome5 name="check" size={14} color="#111827" />}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              )}
            </View>

            <Pressable
              style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {isEditMode ? "Save Changes" : "Add Bus"}
                </Text>
              )}
            </Pressable>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fff" },
  modalKeyboardView: { flex: 1, justifyContent: "flex-end" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#F9FAFB",
  },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },

  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#111827",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  addButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  errorBox: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FFF1F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: { color: "#991B1B", fontWeight: "600", fontSize: 13 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 40 },
  loadingText: { fontSize: 14, color: "#6B7280", fontWeight: "600" },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  emptySub: { fontSize: 13, fontWeight: "600", color: "#6B7280" },

  listContent: { padding: 16, gap: 10 },

  busCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  busCardContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  busIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
  },
  busTextCol: { flex: 1 },
  busRego: { fontSize: 15, fontWeight: "800", color: "#111827" },
  busMeta: { marginTop: 3, fontSize: 12, fontWeight: "600", color: "#6B7280" },

  busRight: { alignItems: "flex-end", gap: 6 },
  busId: { fontSize: 12, fontWeight: "700", color: "#9CA3AF" },
  busActions: { flexDirection: "row", gap: 6 },
  editButton: {
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    maxHeight: "90%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    gap: 4,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#111827" },
  modalClose: { padding: 4 },

  fieldGroup: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  required: { color: "#EF4444" },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  pickerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inputReadOnly: { backgroundColor: "#F3F4F6", color: "#9CA3AF" },
  pickerText: { fontSize: 14, color: "#111827", flex: 1 },
  pickerPlaceholder: { fontSize: 14, color: "#9CA3AF", flex: 1 },

  submitButton: {
    marginTop: 8,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  inlinePickerList: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  pickerCenter: { paddingVertical: 16, alignItems: "center" },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 4,
  },
  projectRowSelected: { backgroundColor: "#F3F4F6" },
  projectName: { fontSize: 15, fontWeight: "700", color: "#111827" },
  projectNameSelected: { color: "#111827" },
  projectId: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 2 },
});
