// ReportFormScreen.tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DropDownPicker from 'react-native-dropdown-picker';
import ImagePickerField from '../components/ImagePicker';
import MapSelector from '../components/map';

type ReportType = 'problem' | 'repair' | 'accident';

function normaliseReportType(value: unknown): ReportType {
  if (value === 'problem' || value === 'repair' || value === 'accident') return value;
  return 'problem'; // default if missing/invalid
}

function reportTypeLabel(t: ReportType) {
  if (t === 'problem') return 'Problem Report';
  if (t === 'repair') return 'Repair Request';
  return 'Accident Report';
}

export default function ReportFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // ✅ read from route param
  const reportType = useMemo(() => normaliseReportType(params.type), [params.type]);

  const [mapLocation, setMapLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState([
    { label: 'Bus 101', value: 'BUS101' },
    { label: 'Bus 205', value: 'BUS205' },
  ]);

  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priority, setPriority] = useState('medium');
  const [priorities, setPriorities] = useState([
    { label: 'Low - Can wait', value: 'low' },
    { label: 'Medium - Soon', value: 'medium' },
    { label: 'High - Urgent', value: 'high' },
    { label: 'Critical - Immediate', value: 'critical' },
  ]);

  const [formData, setFormData] = useState<{
    reportType: ReportType; // ✅ store it
    photos: string[];
    description?: string;
    vehicle?: string;
    priority?: string;
    location?: { latitude: number; longitude: number } | null;
  }>({
    reportType, // ✅ initial value from param
    photos: [],
    location: null,
  });

  // Optional: if you want different placeholder text per type
  const descriptionPlaceholder =
    formData.reportType === 'repair'
      ? 'Describe the maintenance needed (e.g., oil change, brake pads, service interval)...'
      : formData.reportType === 'accident'
        ? 'Describe the accident (what happened, damage observed, any injuries, photos taken)...'
        : 'Describe the issue/malfunction (symptoms, warnings, when it started)...';

  const onSubmit = () => {
    // ✅ payload now includes reportType
    const payload = {
      ...formData,
      vehicle,
      priority,
      location: mapLocation,
    };

    console.log('SUBMIT PAYLOAD:', payload);

    // TODO: send to API / Lambda / RDS
    // fetch(...)

    router.back();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Report Details</Text>

      {/* ✅ Report Type display */}
      <View style={styles.typePill}>
        <Text style={styles.typePillText}>{reportTypeLabel(formData.reportType)}</Text>
      </View>

      {/* Vehicle */}
      <Text style={styles.label}>
        Vehicle <Text style={styles.required}>*</Text>
      </Text>
      <DropDownPicker
        listMode="SCROLLVIEW"
        open={vehicleOpen}
        value={vehicle}
        items={vehicles}
        setOpen={setVehicleOpen}
        setValue={setVehicle}
        setItems={setVehicles}
        placeholder="Select vehicle"
        style={styles.dropdown}
        dropDownContainerStyle={styles.dropdownContainer}
        zIndex={3000}
      />

      {/* Location */}
      <MapSelector
        label="Current Location"
        required
        value={mapLocation}
        onChange={setMapLocation}
      />
      <TextInput
        style={styles.input}
        placeholder="e.g., Main Depot, Route 5, Customer Site"
        placeholderTextColor="#9CA3AF"
      />

      {/* Photos */}
      <Text style={styles.label}>
        Photos <Text style={styles.required}>*</Text>
      </Text>
      <ImagePickerField
        title="Photos"
        required
        value={formData.photos}
        onChange={(uris) => setFormData({ ...formData, photos: uris })}
        captureLabel="Capture Photo"
        uploadLabel="Upload Photo"
      />

      {/* Priority */}
      <Text style={styles.label}>Priority</Text>
      <DropDownPicker
        listMode="SCROLLVIEW"
        open={priorityOpen}
        value={priority}
        items={priorities}
        setOpen={setPriorityOpen}
        setValue={setPriority}
        setItems={setPriorities}
        style={styles.dropdown}
        dropDownContainerStyle={styles.dropdownContainer}
        zIndex={2000}
      />

      {/* Description */}
      <Text style={styles.label}>
        Description <Text style={styles.required}>*</Text>
      </Text>
      <TextInput
        style={styles.textArea}
        placeholder={descriptionPlaceholder}
        placeholderTextColor="#9CA3AF"
        multiline
        textAlignVertical="top"
        onChangeText={(t) => setFormData({ ...formData, description: t })}
        value={formData.description || ''}
      />

      {/* Buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.submitButton} onPress={onSubmit}>
          <Text style={styles.submitText}>Submit Report</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    margin: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
    color: '#111827',
  },

  // ✅ report type pill
  typePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 12,
  },
  typePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },

  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
    marginTop: 16,
    color: '#111827',
  },
  required: { color: '#EF4444' },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  dropdown: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
    borderRadius: 12,
    minHeight: 48,
  },
  dropdownContainer: {
    borderColor: '#E5E7EB',
    borderRadius: 12,
  },
  textArea: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#111827',
    height: 160,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 32,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  submitButton: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
});
