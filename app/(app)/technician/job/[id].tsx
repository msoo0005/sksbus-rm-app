// app/(app)/technician/job/[id].tsx
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import ImagePickerField from '../../../components/ImagePicker';
import PartsUsedCard, { PartCatalogItem } from '../../../components/PartsUsedCard';
import StatusBadge from '../../../components/StatusBadge';
import type { PartUsed, Report } from '../../../types/report';

// TODO: replace with real fetch from API by id
const DEMO_REPORTS: Report[] = [
  {
    id: 2,
    type: 'repair',
    severity: 'low',
    vehicle: 'V-003',
    location: 'Route 12',
    description:
      'Scheduled 50,000 km service due. Needs oil change, filter replacement, and brake inspection.',
    date: '10/13/2025, 2:20 PM',
    status: 'open',
    beforePhotos: [],
    afterPhotos: [],
    partsUsed: [],
    jobHistory: [],
  },
  {
    id: 5,
    type: 'problem',
    severity: 'critical',
    vehicle: 'V-004',
    location: 'Route 8',
    description: 'Warning light on dashboard, needs diagnostic check.',
    date: '10/14/2025, 4:00 PM',
    status: 'open',
    beforePhotos: [],
    afterPhotos: [],
    partsUsed: [],
    jobHistory: [],
  },
];

const PARTS_CATALOG: PartCatalogItem[] = [
  { id: 1, name: 'Heavy Duty Air Filter', code: 'AIR-FLT-HD', stock: 32 },
  { id: 2, name: 'Light Truck Tire 16"', code: 'TIRE-LT-16', stock: 6 },
  { id: 3, name: '12V Heavy Duty Battery', code: 'BAT-12V-HD', stock: 4 },
];

export default function TechnicianJobDetailsScreen() {
  const router = useRouter();

  // ✅ mode passed from /technician/index.tsx:
  // - available tab -> mode=view
  // - myJobs / completed -> mode=edit (or whatever you choose)
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: 'view' | 'edit' }>();
  const canEdit = mode !== 'view';

  const report = useMemo(() => {
    const rid = Number(id);
    return DEMO_REPORTS.find(r => r.id === rid) ?? DEMO_REPORTS[0];
  }, [id]);

  const [workPerformed, setWorkPerformed] = useState(report.workPerformed ?? '');
  const [partsUsed, setPartsUsed] = useState<PartUsed[]>(report.partsUsed ?? []);
  const [afterPhotos, setAfterPhotos] = useState<string[]>(report.afterPhotos ?? []);

  const handleUpdate = () => {
    if (!canEdit) return;
    // TODO: call your backend: PATCH /reports/:id
    // payload: { workPerformed, partsUsed, afterPhotos }
    router.back();
  };

  const handleComplete = () => {
    if (!canEdit) return;

    if (afterPhotos.length < 1) {
      Alert.alert('After Photos required', 'Please upload at least 1 after photo before completing.');
      return;
    }

    // TODO: call your backend: POST /reports/:id/complete or PATCH status=closed
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Job Details' }} />

      <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
        {/* ✅ Header (like screenshot) */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Job #{report.id}</Text>
            <Text style={styles.headerSubtitle}>
              {report.vehicle} - {report.location}
            </Text>

            {!canEdit && (
              <Text style={styles.readOnlyHint}>
                View only — accept the job to update details.
              </Text>
            )}
          </View>

          <View style={styles.headerRight}>
            <StatusBadge type={report.type} />
            <StatusBadge type={report.severity} />
          </View>
        </View>

        <View style={styles.divider} />

        {/* Job description */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Job Description</Text>
          <Text style={styles.bodyText}>{report.description}</Text>
        </View>

        {/* Before photos (always read only) */}
        <ImagePickerField title="Before Photos" value={report.beforePhotos ?? []} readOnly />

        {/* Work performed */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Work Performed</Text>
          <View style={styles.inputWrap}>
            <TextInput
              value={workPerformed}
              onChangeText={setWorkPerformed}
              placeholder="Describe work performed..."
              placeholderTextColor="#6B7280"
              style={[styles.textarea, !canEdit && styles.textareaDisabled]}
              multiline
              editable={canEdit}
            />
          </View>
        </View>

        {/* Parts used */}
        {canEdit ? (
          <PartsUsedCard catalog={PARTS_CATALOG} value={partsUsed} onChange={setPartsUsed} />
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Parts Used</Text>
            {partsUsed.length === 0 ? (
              <Text style={styles.bodyTextMuted}>No parts recorded yet.</Text>
            ) : (
              partsUsed.map(p => (
                <Text key={p.id} style={styles.bodyText}>
                  • {p.name} ({p.code}) x {p.qty}
                </Text>
              ))
            )}
          </View>
        )}

        {/* After photos */}
        <ImagePickerField
          title="After Photos"
          required
          value={afterPhotos}
          onChange={setAfterPhotos}
          captureLabel="Capture After Photo"
          uploadLabel="Upload After Photo"
          showUploadButton
          readOnly={!canEdit}
        />

        {/* ✅ Actions only when editable */}
        {canEdit && (
          <View style={styles.actions}>
            <Pressable style={[styles.actionBtn, styles.updateBtn]} onPress={handleUpdate}>
              <Text style={styles.actionText}>Update Job Details</Text>
            </Pressable>

            <Pressable style={[styles.actionBtn, styles.completeBtn]} onPress={handleComplete}>
              <Text style={styles.actionText}>Complete Job</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F9FAFB' },
  pageContent: { padding: 16, paddingTop: 14, gap: 16 },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft: { flex: 1 },
  headerTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#111827',
    lineHeight: 38,
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 20,
    fontWeight: '700',
    color: '#6B7280',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },

  readOnlyHint: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '800',
    color: '#6B7280',
  },

  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginTop: 8,
    marginBottom: 6,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  bodyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    lineHeight: 22,
  },
  bodyTextMuted: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
    lineHeight: 22,
  },

  inputWrap: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  textarea: {
    minHeight: 90,
    fontSize: 16,
    color: '#111827',
  },
  textareaDisabled: {
    opacity: 0.65,
  },

  actions: { gap: 12, marginTop: 8, marginBottom: 28 },
  actionBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateBtn: { backgroundColor: '#111827' },
  completeBtn: { backgroundColor: '#16A34A' },
  actionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
