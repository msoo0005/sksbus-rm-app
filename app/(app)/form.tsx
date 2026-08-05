import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronDown,
  ChevronLeft,
  Cog,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DropDownPicker from "react-native-dropdown-picker";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api } from "../api/client";
import ImagePickerField, { LocalMedia } from "../components/ImagePicker";
import MapSelector, { LocationValue } from "../components/map";
import { useI18n } from "../i18n/i18n-ctx";
import { useProject } from "../project-ctx";

type Priority = "low" | "medium" | "high" | "critical";

type PriorityOption = {
  value: Priority;
  label: string;
  description: string;
  color: string;
  Icon: typeof ShieldCheck;
};

// Built from translations rather than a static array, since the label and
// (long) description both need to switch with the selected language.
function buildPriorityOptions(t: (key: string) => string): PriorityOption[] {
  return [
    {
      value: "low",
      label: t("reportForm.priorityLowLabel"),
      description: t("reportForm.priorityLowDesc"),
      color: "#16A34A",
      Icon: ShieldCheck,
    },
    {
      value: "medium",
      label: t("reportForm.priorityMediumLabel"),
      description: t("reportForm.priorityMediumDesc"),
      color: "#EAB308",
      Icon: Wrench,
    },
    {
      value: "high",
      label: t("reportForm.priorityHighLabel"),
      description: t("reportForm.priorityHighDesc"),
      color: "#EA580C",
      Icon: Cog,
    },
    {
      value: "critical",
      label: t("reportForm.priorityCriticalLabel"),
      description: t("reportForm.priorityCriticalDesc"),
      color: "#DC2626",
      Icon: TriangleAlert,
    },
  ];
}

function PriorityPickerModal({
  visible,
  value,
  options,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: Priority;
  options: PriorityOption[];
  onSelect: (v: Priority) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={priorityModalStyles.backdrop}>
        <View style={priorityModalStyles.sheet}>
          <View style={priorityModalStyles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <ChevronLeft size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={priorityModalStyles.headerTitle}>
              {t("reportForm.priorityModalTitle")}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView contentContainerStyle={priorityModalStyles.body}>
            <Text style={priorityModalStyles.sectionLabel}>
              {t("reportForm.selectPriorityLevel")}{" "}
              <Text style={priorityModalStyles.required}>*</Text>
            </Text>

            {options.map((opt) => {
              const selected = value === opt.value;
              const Icon = opt.Icon;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    priorityModalStyles.card,
                    selected && { borderColor: opt.color },
                  ]}
                  onPress={() => onSelect(opt.value)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      priorityModalStyles.iconCircle,
                      { backgroundColor: opt.color },
                    ]}
                  >
                    <Icon size={26} color="#fff" />
                  </View>
                  <View style={priorityModalStyles.cardText}>
                    <Text style={priorityModalStyles.cardTitle}>
                      {opt.label}
                    </Text>
                    <Text style={priorityModalStyles.cardDesc}>
                      {opt.description}
                    </Text>
                  </View>
                  <View
                    style={[
                      priorityModalStyles.radio,
                      selected && { borderColor: opt.color },
                    ]}
                  >
                    {selected && (
                      <View
                        style={[
                          priorityModalStyles.radioDot,
                          { backgroundColor: opt.color },
                        ]}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={priorityModalStyles.doneButton}
            onPress={onClose}
          >
            <Text style={priorityModalStyles.doneText}>{t("reportForm.done")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

type ReportType = "problem" | "repair" | "accident";

function normaliseReportType(value: unknown): ReportType {
  if (value === "problem" || value === "repair" || value === "accident") {
    return value;
  }
  return "problem";
}

function reportTypeLabel(type: ReportType, translate: (key: string) => string) {
  if (type === "problem") return translate("reportForm.typeProblem");
  if (type === "repair") return translate("reportForm.typeRepair");
  return translate("reportForm.typeAccident");
}

type BusItem = { label: string; value: string };

type PresignResponse = {
  uploadUrl: string;
  s3_bucket?: string;
  s3_key: string;
};

async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return await res.blob();
}

export default function ReportFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { t } = useI18n();
  const reportType = useMemo(
    () => normaliseReportType(params.type),
    [params.type],
  );

  const priorityOptions = useMemo(() => buildPriorityOptions(t), [t]);

  const { projectId, loading: projectLoading } = useProject();

  const [mapLocation, setMapLocation] = useState<LocationValue | null>(null);
  const [locationDesc, setLocationDesc] = useState("");
  const [locationEditedManually, setLocationEditedManually] = useState(false);

  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<BusItem[]>([]);

  const [priorityModalVisible, setPriorityModalVisible] = useState(false);
  const [priority, setPriority] = useState<Priority>("medium");

  const [photos, setPhotos] = useState<LocalMedia[]>([]);
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (projectLoading) return;

        if (!projectId) {
          if (alive) {
            setVehicles([]);
            setVehicle(null);
          }
          return;
        }

        const res = await api.request<any>(
          `/buses?project_id=${encodeURIComponent(projectId)}`,
          { method: "GET" },
        );

        const list: any[] = Array.isArray(res) ? res : (res?.items ?? []);

        const items: BusItem[] = list
          .map((b: any) => {
            const id = b?.bus_id ?? b?.bus_rego ?? b?.busRego ?? b?.id;
            if (!id) return null;

            const route = b?.bus_route ?? b?.route ?? b?.busRoute;
            const model = b?.bus_model ?? b?.model ?? b?.busModel;

            return {
              label: `${String(id)}${route ? ` • ${route}` : ""}${
                model ? ` • ${model}` : ""
              }`,
              value: String(id),
            };
          })
          .filter(Boolean) as BusItem[];

        if (!alive) return;

        setVehicles(items);
        setVehicle((prev) =>
          prev && items.some((x) => x.value === prev) ? prev : null,
        );
      } catch (e) {
        console.error("Failed to load buses", e);
        if (alive) {
          setVehicles([]);
          setVehicle(null);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [projectId, projectLoading]);

  useEffect(() => {
    if (mapLocation?.address && !locationEditedManually) {
      setLocationDesc(mapLocation.address);
    }
  }, [mapLocation, locationEditedManually]);

  const handleMapLocationChange = (value: LocationValue) => {
    setMapLocation(value);

    if (value.address) {
      setLocationDesc(value.address);
      setLocationEditedManually(false);
    }
  };

  const createReport = async () => {
    if (!projectId) throw new Error("Project is not selected");
    if (!vehicle) throw new Error("Vehicle is required");
    if (!description.trim()) throw new Error("Description is required");

    const res = await api.request<{ report_id: number }>("/reports", {
      method: "POST",
      body: JSON.stringify({
        project_id: projectId,
        report_type: reportType,
        report_desc: description.trim(),
        report_location: locationDesc.trim() || null,
        report_lat: mapLocation?.latitude ?? null,
        report_lng: mapLocation?.longitude ?? null,
        report_priority: priority,
        bus_id: vehicle,
      }),
    });

    return res.report_id;
  };

  const uploadOneToReport = async (
    reportId: number,
    localUri: string,
    mime_type: string,
  ) => {
    const presign = await api.request<PresignResponse>(
      `/reports/${reportId}/media/presign?mime=${encodeURIComponent(mime_type)}`,
      { method: "GET" },
    );

    const blob = await uriToBlob(localUri);

    const putRes = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mime_type },
      body: blob,
    });

    if (!putRes.ok) throw new Error(`S3 upload failed (${putRes.status})`);

    await api.request(`/reports/${reportId}/media/confirm`, {
      method: "POST",
      body: JSON.stringify({
        s3_key: presign.s3_key,
        mime_type,
        size_bytes: blob.size,
      }),
    });
  };

  const validateForm = (): string | null => {
    if (projectLoading) return t("reportForm.validationLoadingProject");
    if (!projectId) return t("reportForm.validationProjectNotSelected");
    if (!vehicle) return t("reportForm.validationVehicleRequired");
    if (!description.trim()) return t("reportForm.validationDescriptionRequired");
    if (photos.length === 0) return t("reportForm.validationPhotoRequired");
    return null;
  };

  const doSubmit = async () => {
    try {
      setSubmitting(true);
      setUploadingIndex(null);

      const reportId = await createReport();

      for (let i = 0; i < photos.length; i++) {
        setUploadingIndex(i);
        await uploadOneToReport(
          reportId,
          photos[i].localUri,
          photos[i].mime_type,
        );
      }

      setUploadingIndex(null);
      Alert.alert(t("common.success"), t("reportForm.reportSubmittedSuccess"));
      router.back();
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? t("reportForm.failedToSubmitReport"));
    } finally {
      setSubmitting(false);
      setUploadingIndex(null);
    }
  };

  const onSubmit = () => {
    const error = validateForm();
    if (error) {
      Alert.alert(t("common.error"), error);
      return;
    }

    Alert.alert(
      t("reportForm.submitReport"),
      t("reportForm.submitReportConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.submit"), onPress: doSubmit },
      ],
    );
  };

  const submitLabel =
    submitting && uploadingIndex !== null
      ? t("reportForm.uploading", { current: uploadingIndex + 1, total: photos.length })
      : submitting
        ? t("reportForm.submitting")
        : t("reportForm.submitReport");

  const vehiclePlaceholder = projectLoading
    ? t("reportForm.vehiclePlaceholderLoadingProject")
    : !projectId
      ? t("reportForm.vehiclePlaceholderSelectProjectFirst")
      : vehicles.length
        ? t("reportForm.vehiclePlaceholderSelectVehicle")
        : t("reportForm.vehiclePlaceholderLoadingVehicles");

  const selectedPriorityOption =
    priorityOptions.find((o) => o.value === priority) ?? priorityOptions[1];

  return (
    <KeyboardAwareScrollView
      style={styles.flex}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      bottomOffset={24}
    >
      <Text style={styles.title}>{t("reportForm.title")}</Text>

      <View style={styles.typePill}>
        <Text style={styles.typePillText}>{reportTypeLabel(reportType, t)}</Text>
      </View>

      <View style={styles.projectPill}>
        <Text style={styles.projectPillText}>
          {t("reportForm.projectPrefix")}{" "}
          {projectLoading ? t("reportForm.loadingEllipsis") : (projectId ?? t("reportForm.notSelected"))}
        </Text>
      </View>

      <Text style={styles.label}>{t("reportForm.vehicleLabel")}</Text>
      <View style={{ zIndex: 3000 }}>
        <DropDownPicker
          listMode="SCROLLVIEW"
          open={vehicleOpen}
          value={vehicle}
          items={vehicles}
          setOpen={setVehicleOpen}
          setValue={setVehicle}
          setItems={setVehicles}
          searchable
          searchPlaceholder={t("reportForm.searchVehiclesPlaceholder")}
          placeholder={vehiclePlaceholder}
          style={styles.dropdown}
          dropDownContainerStyle={styles.dropdownContainer}
          zIndex={3000}
          disabled={submitting || projectLoading || !projectId}
        />
      </View>

      <MapSelector
        label={t("reportForm.currentLocationLabel")}
        required
        value={mapLocation}
        onChange={handleMapLocationChange}
      />

      <Text style={styles.label}>{t("reportForm.locationDescLabel")}</Text>
      <TextInput
        style={styles.input}
        placeholder={t("reportForm.locationDescPlaceholder")}
        placeholderTextColor="#9CA3AF"
        value={locationDesc}
        onChangeText={(text) => {
          setLocationEditedManually(true);
          setLocationDesc(text);
        }}
        editable={!submitting}
      />

      <Text style={styles.label}>{t("reportForm.photosLabel")}</Text>
      <ImagePickerField
        title={t("reportForm.photosTitle")}
        required
        value={photos}
        onChange={setPhotos}
        disabled={submitting}
      />

      <Text style={styles.label}>{t("reportForm.priorityLabel")}</Text>
      <TouchableOpacity
        style={styles.priorityField}
        onPress={() => setPriorityModalVisible(true)}
        disabled={submitting}
        activeOpacity={0.7}
      >
        <View
          style={[
            styles.priorityDot,
            { backgroundColor: selectedPriorityOption.color },
          ]}
        />
        <Text style={styles.priorityFieldText}>
          {selectedPriorityOption.label}
        </Text>
        <ChevronDown size={18} color="#6B7280" />
      </TouchableOpacity>

      <PriorityPickerModal
        visible={priorityModalVisible}
        value={priority}
        options={priorityOptions}
        onSelect={setPriority}
        onClose={() => setPriorityModalVisible(false)}
      />

      <Text style={styles.label}>{t("reportForm.descriptionLabel")}</Text>
      <TextInput
        style={styles.textArea}
        placeholder={t("reportForm.descriptionPlaceholder")}
        placeholderTextColor="#9CA3AF"
        multiline
        value={description}
        onChangeText={setDescription}
        editable={!submitting}
      />

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => router.back()}
          disabled={submitting}
        >
          <Text style={styles.cancelText}>{t("common.cancel")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.submitButton,
            (!projectId || projectLoading) && { opacity: 0.6 },
          ]}
          onPress={onSubmit}
          disabled={submitting || projectLoading || !projectId}
        >
          <Text style={styles.submitText}>{submitLabel}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    margin: 10,
    paddingBottom: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 12,
    color: "#111827",
  },
  typePill: {
    alignSelf: "flex-start",
    backgroundColor: "#F3F4F6",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 12,
  },
  typePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  projectPill: {
    alignSelf: "flex-start",
    backgroundColor: "#EEF2FF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 6,
  },
  projectPillText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 6,
    marginTop: 16,
    color: "#111827",
  },
  input: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#111827",
  },
  dropdown: {
    backgroundColor: "#F9FAFB",
    borderColor: "#E5E7EB",
    borderRadius: 12,
    minHeight: 48,
  },
  dropdownContainer: {
    borderColor: "#E5E7EB",
    borderRadius: 12,
  },
  priorityField: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    gap: 10,
  },
  priorityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  priorityFieldText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  textArea: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: "#111827",
    height: 160,
    textAlignVertical: "top",
  },
  buttonRow: {
    flexDirection: "row",
    marginTop: 32,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelText: {
    color: "#111827",
    fontWeight: "600",
  },
  submitButton: {
    flex: 1,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});

const priorityModalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: "90%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#111827",
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  body: {
    padding: 20,
    paddingBottom: 12,
  },
  sectionLabel: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 14,
  },
  required: {
    color: "#DC2626",
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    gap: 14,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: "#6B7280",
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  doneButton: {
    margin: 20,
    marginTop: 4,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  doneText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
});
