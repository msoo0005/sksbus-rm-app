// app/form.tsx (ReportFormScreen) — creates report + uploads photos ONLY when user presses Submit
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DropDownPicker from "react-native-dropdown-picker";
import { api } from "../api/client";
import ImagePickerField, { LocalMedia } from "../components/ImagePicker"; // ✅ local picker: returns { localUri, mime_type }
import MapSelector from "../components/map";

type ReportType = "problem" | "repair" | "accident";

function normaliseReportType(value: unknown): ReportType {
  if (value === "problem" || value === "repair" || value === "accident") return value;
  return "problem";
}

function reportTypeLabel(t: ReportType) {
  if (t === "problem") return "Problem Report";
  if (t === "repair") return "Repair Request";
  return "Accident Report";
}

type BusItem = { label: string; value: string };

type PresignResponse = {
  uploadUrl: string; // ✅ matches your Lambda: { uploadUrl, s3_bucket, s3_key }
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
  const reportType = useMemo(() => normaliseReportType(params.type), [params.type]);

  const [mapLocation, setMapLocation] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  const [locationDesc, setLocationDesc] = useState("");

  // Vehicles dropdown
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<BusItem[]>([]);

  // Priority dropdown
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");

  // Form state
  const [photos, setPhotos] = useState<LocalMedia[]>([]);
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  // ✅ Load buses
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await api.request<any>("/buses", { method: "GET" });

        const list: any[] = Array.isArray(res) ? res : res?.items ?? [];

        const items: BusItem[] = list
          .map((b: any) => {
            const id = b?.bus_id ?? b?.bus_rego ?? b?.busRego ?? b?.id;
            if (!id) return null;

            const route = b?.bus_route ?? b?.route ?? b?.busRoute;
            const model = b?.bus_model ?? b?.model ?? b?.busModel;

            return {
              label: `${String(id)}${route ? ` • ${route}` : ""}${model ? ` • ${model}` : ""}`,
              value: String(id),
            };
          })
          .filter(Boolean) as BusItem[];

        if (alive) setVehicles(items);
      } catch (e) {
        console.error("Failed to load buses", e);
        if (alive) setVehicles([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Optional: prefill location description once if MapSelector provides address
  useEffect(() => {
    const anyLoc = mapLocation as any;
    const addr = anyLoc?.address as string | undefined;
    if (addr && !locationDesc.trim()) setLocationDesc(addr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLocation]);

  const createReport = async () => {
    if (!vehicle) throw new Error("Vehicle is required");
    if (!description.trim()) throw new Error("Description is required");

    const res = await api.request<{ report_id: number }>("/reports", {
      method: "POST",
      body: JSON.stringify({
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

  // ✅ Uses your Lambda EXACTLY:
  // GET  /reports/{id}/media/presign?mime=...
  // POST /reports/{id}/media/confirm  body: { s3_key, mime_type, size_bytes }
  const uploadOneToReport = async (reportId: number, localUri: string, mime_type: string) => {
    const presign = await api.request<PresignResponse>(
      `/reports/${reportId}/media/presign?mime=${encodeURIComponent(mime_type)}`,
      { method: "GET" }
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

  const onSubmit = async () => {
    try {
      setSubmitting(true);
      setUploadingIndex(null);

      // ✅ Validate first (no API calls yet)
      if (!vehicle) throw new Error("Vehicle is required");
      if (!description.trim()) throw new Error("Description is required");
      if (photos.length === 0) throw new Error("At least one photo is required");

      // ✅ Create report only on submit
      const reportId = await createReport();

      // ✅ Upload photos after report is created
      for (let i = 0; i < photos.length; i++) {
        setUploadingIndex(i);
        await uploadOneToReport(reportId, photos[i].localUri, photos[i].mime_type);
      }

      setUploadingIndex(null);
      Alert.alert("Success", "Report submitted successfully");
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to submit report");
    } finally {
      setSubmitting(false);
      setUploadingIndex(null);
    }
  };

  const submitLabel =
    submitting && uploadingIndex !== null
      ? `Uploading ${uploadingIndex + 1}/${photos.length}...`
      : submitting
        ? "Submitting..."
        : "Submit Report";

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Report Details</Text>

      <View style={styles.typePill}>
        <Text style={styles.typePillText}>{reportTypeLabel(reportType)}</Text>
      </View>

      {/* Vehicle */}
      <Text style={styles.label}>Vehicle *</Text>
      <View style={{ zIndex: 3000 }}>
        <DropDownPicker
          listMode="SCROLLVIEW"
          open={vehicleOpen}
          value={vehicle}
          items={vehicles}
          setOpen={setVehicleOpen}
          setValue={setVehicle}
          setItems={setVehicles}
          placeholder={vehicles.length ? "Select vehicle" : "Loading vehicles..."}
          style={styles.dropdown}
          dropDownContainerStyle={styles.dropdownContainer}
          zIndex={3000}
          disabled={submitting}
        />
      </View>

      {/* Location */}
      <MapSelector label="Current Location" required value={mapLocation} onChange={setMapLocation} />

      {/* Location description */}
      <Text style={styles.label}>Location Description</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Stop 12 near the mall entrance"
        placeholderTextColor="#9CA3AF"
        value={locationDesc}
        onChangeText={setLocationDesc}
        editable={!submitting}
      />

      {/* Photos */}
      <Text style={styles.label}>Photos *</Text>
      <ImagePickerField
        title="Photos"
        required
        value={photos}
        onChange={setPhotos}
        disabled={submitting}
      />

      {/* Priority */}
      <Text style={styles.label}>Priority</Text>
      <View style={{ zIndex: 2000 }}>
        <DropDownPicker
          listMode="SCROLLVIEW"
          open={priorityOpen}
          value={priority}
          items={[
            { label: "Low", value: "low" },
            { label: "Medium", value: "medium" },
            { label: "High", value: "high" },
            { label: "Critical", value: "critical" },
          ]}
          setOpen={setPriorityOpen}
          setValue={setPriority}
          setItems={() => {}}
          style={styles.dropdown}
          dropDownContainerStyle={styles.dropdownContainer}
          zIndex={2000}
          disabled={submitting}
        />
      </View>

      {/* Description */}
      <Text style={styles.label}>Description *</Text>
      <TextInput
        style={styles.textArea}
        placeholder="Describe the issue..."
        placeholderTextColor="#9CA3AF"
        multiline
        value={description}
        onChangeText={setDescription}
        editable={!submitting}
      />

      {/* Buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()} disabled={submitting}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.submitButton} onPress={onSubmit} disabled={submitting}>
          <Text style={styles.submitText}>{submitLabel}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
