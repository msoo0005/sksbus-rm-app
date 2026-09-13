import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Bus,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  Cog,
  Search,
  ShieldCheck,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api } from "../api/client";
import ImagePickerField, { LocalMedia } from "../components/ImagePicker";
import InstrumentClusterIcon from "../components/icons/InstrumentClusterIcon";
import MapSelector, { LocationValue } from "../components/map";
import VerificationModal from "../components/VerificationModal";
import { useI18n } from "../i18n/i18n-ctx";
import { useProject } from "../project-ctx";
import { reportTypeTitleLabel } from "../utils/reportType";
import { getRouteColourHex, routeColourNeedsBorder } from "../utils/routeColours";

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

type BusItem = { label: string; value: string; routeColour?: string | null };

// Splits the combined "busId • route • model" label built in the vehicles
// fetch below back into a title (bus id) and subtitle (route/model), so the
// picker can show them as two lines instead of one long run-on string.
function splitVehicleLabel(label: string): { title: string; subtitle: string } {
  const [title, ...rest] = label.split(" • ");
  return { title, subtitle: rest.join(" • ") };
}

function VehiclePickerModal({
  visible,
  items,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  items: BusItem[];
  value: string | null;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={vehicleModalStyles.backdrop}>
        <View style={vehicleModalStyles.sheet}>
          <View style={vehicleModalStyles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <ChevronLeft size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={vehicleModalStyles.headerTitle}>
              {t("reportForm.selectVehicleModalTitle")}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={vehicleModalStyles.searchBox}>
            <Search size={16} color="#9CA3AF" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("reportForm.searchVehiclesPlaceholder")}
              placeholderTextColor="#9CA3AF"
              style={vehicleModalStyles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery("")} hitSlop={10}>
                <X size={16} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.value}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={vehicleModalStyles.listContent}
            ItemSeparatorComponent={() => <View style={vehicleModalStyles.separator} />}
            renderItem={({ item }) => {
              const selected = item.value === value;
              const { title, subtitle } = splitVehicleLabel(item.label);
              return (
                <TouchableOpacity
                  style={vehicleModalStyles.row}
                  onPress={() => {
                    onSelect(item.value);
                    onClose();
                  }}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      vehicleModalStyles.busIcon,
                      selected && vehicleModalStyles.busIconSelected,
                    ]}
                  >
                    <Bus size={16} color={selected ? "#fff" : "#6B7280"} />
                  </View>
                  <View style={vehicleModalStyles.rowText}>
                    <Text style={vehicleModalStyles.rowTitle}>{title}</Text>
                    {!!subtitle && (
                      <View style={vehicleModalStyles.subtitleRow}>
                        {!!item.routeColour && (
                          <View
                            style={[
                              vehicleModalStyles.routeDot,
                              { backgroundColor: getRouteColourHex(item.routeColour) },
                              routeColourNeedsBorder(item.routeColour) &&
                                vehicleModalStyles.routeDotBordered,
                            ]}
                          />
                        )}
                        <Text style={vehicleModalStyles.rowSubtitle} numberOfLines={1}>
                          {subtitle}
                        </Text>
                      </View>
                    )}
                  </View>
                  {selected && <Check size={18} color="#111827" />}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={vehicleModalStyles.empty}>
                <Text style={vehicleModalStyles.emptyText}>
                  {t("reportForm.noVehiclesFound")}
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

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

  const [vehicleModalVisible, setVehicleModalVisible] = useState(false);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<BusItem[]>([]);

  const [priorityModalVisible, setPriorityModalVisible] = useState(false);
  const [priority, setPriority] = useState<Priority>("medium");

  const [dashboardPhoto, setDashboardPhoto] = useState<LocalMedia[]>([]);
  const [exteriorPhoto, setExteriorPhoto] = useState<LocalMedia[]>([]);
  const [issuePhotos, setIssuePhotos] = useState<LocalMedia[]>([]);
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [verifyVisible, setVerifyVisible] = useState(false);

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
            const routeColour = b?.bus_route_colour ?? b?.routeColour;
            const routeNumber = b?.bus_route_number ?? b?.routeNumber;

            return {
              // Route number, then route colour, then the route's name/path.
              label: `${String(id)}${routeNumber ? ` • ${routeNumber}` : ""}${
                routeColour ? ` • ${routeColour}` : ""
              }${route ? ` • ${route}` : ""}`,
              value: String(id),
              routeColour: routeColour ?? null,
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
    if (dashboardPhoto.length === 0) return t("reportForm.validationDashboardPhotoRequired");
    if (exteriorPhoto.length === 0) return t("reportForm.validationExteriorPhotoRequired");
    if (issuePhotos.length === 0) return t("reportForm.validationIssuePhotoRequired");
    return null;
  };

  const doSubmit = async (selfie: LocalMedia, verifiedName: string) => {
    try {
      setSubmitting(true);
      setUploadingIndex(null);

      const reportId = await createReport();

      // Identity-verification selfie — a dedicated presign/confirm pair that
      // writes straight onto the REPORT row, separate from the report-photo
      // gallery uploaded below.
      const selfiePresign = await api.request<PresignResponse>(
        `/reports/${reportId}/selfie/presign?mime=${encodeURIComponent(selfie.mime_type)}`,
      );
      const selfieBlob = await uriToBlob(selfie.localUri);
      const selfiePut = await fetch(selfiePresign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": selfie.mime_type },
        body: selfieBlob,
      });
      if (!selfiePut.ok) throw new Error(`Selfie upload failed (${selfiePut.status})`);
      await api.confirmReportSelfie(reportId, {
        s3_key: selfiePresign.s3_key,
        mime_type: selfie.mime_type,
        size_bytes: selfieBlob.size,
        verified_name: verifiedName,
      });

      const photos = [...dashboardPhoto, ...exteriorPhoto, ...issuePhotos];

      for (let i = 0; i < photos.length; i++) {
        setUploadingIndex(i);
        await uploadOneToReport(
          reportId,
          photos[i].localUri,
          photos[i].mime_type,
        );
      }

      setUploadingIndex(null);
      setVerifyVisible(false);
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

    setVerifyVisible(true);
  };

  const totalPhotoCount = dashboardPhoto.length + exteriorPhoto.length + issuePhotos.length;

  const submitLabel =
    submitting && uploadingIndex !== null
      ? t("reportForm.uploading", { current: uploadingIndex + 1, total: totalPhotoCount })
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
      <Text style={styles.title}>{reportTypeTitleLabel(reportType, t)}</Text>

      <View style={styles.projectPill}>
        <Text style={styles.projectPillText}>
          {t("reportForm.projectPrefix")}{" "}
          {projectLoading ? t("reportForm.loadingEllipsis") : (projectId ?? t("reportForm.notSelected"))}
        </Text>
      </View>

      <Text style={styles.label}>{t("reportForm.vehicleLabel")}</Text>
      <TouchableOpacity
        style={styles.vehicleField}
        onPress={() => setVehicleModalVisible(true)}
        disabled={submitting || projectLoading || !projectId}
        activeOpacity={0.7}
      >
        <Bus size={16} color="#6B7280" />
        <Text
          style={[styles.vehicleFieldText, !vehicle && styles.vehicleFieldPlaceholder]}
          numberOfLines={1}
        >
          {vehicle
            ? vehicles.find((v) => v.value === vehicle)?.label ?? vehicle
            : vehiclePlaceholder}
        </Text>
        <ChevronDown size={18} color="#6B7280" />
      </TouchableOpacity>

      <VehiclePickerModal
        visible={vehicleModalVisible}
        items={vehicles}
        value={vehicle}
        onSelect={setVehicle}
        onClose={() => setVehicleModalVisible(false)}
      />

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

      <Text style={styles.label}>{t("reportForm.photosSectionLabel")}</Text>

      <Text style={styles.photoHint}>{t("reportForm.dashboardPhotoHint")}</Text>
      <ImagePickerField
        title={t("reportForm.dashboardPhotoTitle")}
        icon={<InstrumentClusterIcon size={18} color="#2563EB" />}
        iconAccentLight="#EFF6FF"
        required
        maxItems={1}
        value={dashboardPhoto}
        onChange={setDashboardPhoto}
        disabled={submitting}
      />

      <Text style={[styles.photoHint, styles.photoHintSpaced]}>{t("reportForm.exteriorPhotoHint")}</Text>
      <ImagePickerField
        title={t("reportForm.exteriorPhotoTitle")}
        icon={<Bus size={18} color="#16A34A" />}
        iconAccentLight="#F0FDF4"
        required
        maxItems={1}
        value={exteriorPhoto}
        onChange={setExteriorPhoto}
        disabled={submitting}
      />

      <Text style={[styles.photoHint, styles.photoHintSpaced]}>{t("reportForm.issuePhotosHint")}</Text>
      <ImagePickerField
        title={t("reportForm.issuePhotosTitle")}
        icon={<Camera size={18} color="#7C3AED" />}
        iconAccentLight="#F5F3FF"
        required
        value={issuePhotos}
        onChange={setIssuePhotos}
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

      <VerificationModal
        visible={verifyVisible}
        title={t("verification.submitReportTitle")}
        message={t("verification.submitReportMessage")}
        submitting={submitting}
        onCancel={() => setVerifyVisible(false)}
        onConfirm={({ selfie, name }) => doSubmit(selfie, name)}
      />
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
  photoHint: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 8,
  },
  photoHintSpaced: {
    marginTop: 16,
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
  vehicleField: {
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
  vehicleFieldText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  vehicleFieldPlaceholder: {
    color: "#9CA3AF",
    fontWeight: "500",
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

const vehicleModalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: "85%",
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
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    margin: 16,
    marginBottom: 8,
    backgroundColor: "#F3F4F6",
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  separator: {
    height: 1,
    backgroundColor: "#F3F4F6",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  busIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  busIconSelected: {
    backgroundColor: "#111827",
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },
  subtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  routeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  routeDotBordered: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  rowSubtitle: {
    fontSize: 13,
    color: "#6B7280",
  },
  empty: {
    paddingTop: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#9CA3AF",
  },
});
