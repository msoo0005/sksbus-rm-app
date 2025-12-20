import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DropDownPicker from 'react-native-dropdown-picker';
import ImagePickerField from '../components/ImagePicker';
import MapSelector from '../components/map';

export default function ReportFormScreen() {

  const [mapLocation, setMapLocation] = useState<{
  latitude: number;
  longitude: number;
} | null>(null);
  
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [vehicle, setVehicle] = useState(null);
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
    photos?: string[];        // <-- change from photo?: string
    description?: string;
    vehicle?: string;
    priority?: string;
    location?: { latitude: number; longitude: number } | null;
  }>({
    photos: [],               // initialize as empty array
    location: null,
  });


  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Report Details</Text>

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
        value={formData.photos || []}
        onChange={(uris) => setFormData({ ...formData, photos: uris })}
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
        placeholder="Describe the issue, maintenance needed, or incident details..."
        placeholderTextColor="#9CA3AF"
        multiline
        textAlignVertical="top"
      />

      {/* Buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.cancelButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.submitButton}>
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
    margin: 10
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 24,
    color: '#111827',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
    marginTop: 16,
    color: '#111827',
  },
  required: {
    color: '#EF4444',
  },
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
