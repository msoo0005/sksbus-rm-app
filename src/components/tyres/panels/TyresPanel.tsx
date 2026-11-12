import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
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
import { api, type Tyre, type TyreStatus } from "../../../api/client";
import RetreadCountSelector, { toRetreadBucket } from "../../RetreadCountSelector";
import ImagePickerField, { type LocalMedia } from "../../ImagePicker";
import DraftRestoreBar from "../../DraftRestoreBar";
import FilterChipRow from "../../FilterChipRow";
import TyreListRow from "../TyreListRow";
import ThicknessInputRow, { emptyThicknessCells, parseThicknessCells } from "../ThicknessInputRow";
import TyreTreadProfile from "../../TyreTreadProfile";
import { useFormDraft } from "../../../hooks/useFormDraft";
import { useI18n } from "../../../i18n/i18n-ctx";
import { uploadTyrePhoto } from "../../../utils/tyrePhotoUpload";
import type { TyreSectionData } from "../../../hooks/useTyreSectionData";

// Every tyre in the fleet as a thing in its own right — fitted, spare, away for
// retreading or scrapped — plus the way new casings enter stock.
//
// A PANEL, not a screen: it never fetches on focus (see useTyreSectionData) and
// owns only its search text and the add-tyre form. The filter is owned by the
// section above, so the attention strip can select "past limit" directly.
//
// The separate "NEEDS REPLACING" card that used to sit above this list is gone.
// It rendered the low-tread tyres a second time, immediately above the same
// tyres in the main list, each already carrying a "needs change" pill. It is now
// the first filter instead, which is both shorter and actually filters.

export type TyreFilter = "all" | "pastLimit" | TyreStatus;

const EMPTY_FORM = {
  tyre_serial_number: "",
  tyre_brand: "",
  tyre_model: "",
  tyre_retread_count: "0",
  tyre_tread_count: "4",
  tyre_bought_date: "",
  // One cell per groove: the tyre's thickness as it enters stock.
  intake_thickness: emptyThicknessCells(4),
};

type Props = {
  data: TyreSectionData;
  filter: TyreFilter;
  onFilterChange: (f: TyreFilter) => void;
};

export default function TyresPanel({ data, filter, onFilterChange }: Props) {
  const router = useRouter();
  const { t } = useI18n();

  const [tyreQuery, setTyreQuery] = useState("");
  const [addVisible, setAddVisible] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  // A casing entering stock with a retread count needs the sticker that count
  // was read off — same rule as the inspection and replacement forms. Photos
  // are local file URIs that may not survive the app being killed, so this is
  // kept out of the draft, as the other tyre forms do.
  const [retreadSticker, setRetreadSticker] = useState<LocalMedia[]>([]);

  const draft = useFormDraft(
    addVisible ? "add-tyre-form" : null,
    form,
    JSON.stringify(form) !== JSON.stringify(EMPTY_FORM),
  );
  const restoreDraft = () => {
    const v = draft.restore();
    if (v) {
      // Drafts saved before readings existed have none: give them empty cells.
      const count = Number(v.tyre_tread_count) || 4;
      const cells = Array.isArray(v.intake_thickness) && v.intake_thickness.length === count
        ? v.intake_thickness
        : emptyThicknessCells(count);
      setForm({ ...v, intake_thickness: cells });
    }
  };

  const inventory = useMemo(() => {
    const q = tyreQuery.trim().toLowerCase();
    return data.tyres
      .filter((x) => {
        if (filter === "all") return true;
        if (filter === "pastLimit") return data.lowTreadIds.has(x.tyre_id);
        return x.tyre_status === filter;
      })
      .filter((x) => {
        if (!q) return true;
        return (
          x.tyre_serial_number.toLowerCase().includes(q) ||
          (x.tyre_brand ?? "").toLowerCase().includes(q) ||
          (x.tyre_model ?? "").toLowerCase().includes(q) ||
          (x.current_bus_id ?? "").toLowerCase().includes(q) ||
          (x.current_bus_ev_no ?? "").toLowerCase().includes(q)
        );
      });
  }, [data.tyres, data.lowTreadIds, filter, tyreQuery]);

  /**
   * Every tyre row ends at that tyre's own record — fitted or not.
   *
   * A mounted tyre used to jump sideways into its bus's replacement screen with
   * the wheel preselected. That was the edge that made this section loop: bus
   * page -> tyre -> bus page -> ... The record still names the bus and the
   * wheel; replacing a tyre starts from the Buses tab, where the same tyre is
   * flagged and the row deep-links to the wheel.
   */
  const openTyre = (tyre: Tyre) => router.push(`/tyres/tyre/${tyre.tyre_id}` as any);

  const submitAdd = async () => {
    if (!form.tyre_serial_number.trim()) {
      Alert.alert(t("common.validation"), "Serial number is required.");
      return;
    }
    const treadCount = Number(form.tyre_tread_count);
    if (treadCount !== 3 && treadCount !== 4) {
      Alert.alert(t("common.validation"), "Groove count must be 3 or 4.");
      return;
    }
    const intake = parseThicknessCells(form.intake_thickness);
    if (!intake || intake.length !== treadCount) {
      Alert.alert(t("common.validation"), t("tyres.addTyre.thicknessRequired", { count: treadCount }));
      return;
    }
    const retreadCount = toRetreadBucket(Number(form.tyre_retread_count));
    if (retreadCount > 0 && !retreadSticker.length) {
      Alert.alert(t("common.validation"), t("tyres.addTyre.retreadStickerRequired"));
      return;
    }
    try {
      setSubmitting(true);
      // Required evidence, so a failed upload fails the whole add rather than
      // creating a casing whose retread count has nothing behind it.
      const retread_sticker_s3_key = retreadSticker.length
        ? await uploadTyrePhoto(retreadSticker[0], "retread_sticker")
        : undefined;
      await api.createTyre({
        tyre_serial_number: form.tyre_serial_number.trim(),
        tyre_brand: form.tyre_brand.trim() || undefined,
        tyre_model: form.tyre_model.trim() || undefined,
        tyre_retread_count: retreadCount,
        retread_sticker_s3_key,
        tyre_tread_count: treadCount,
        tyre_bought_date: form.tyre_bought_date.trim() || undefined,
        intake_thickness: intake,
      });
      draft.clear();
      setRetreadSticker([]);
      setAddVisible(false);
      await data.refresh();
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const st = data.counts.byStatus;

  return (
    <View style={s.fill}>
      <FlatList
        data={inventory}
        keyExtractor={(item) => String(item.tyre_id)}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} />
        }
        ListHeaderComponent={
          <>
            <View style={s.headerRow}>
              <Text style={s.subtitle}>
                {t("tyres.replacements.subtitle", {
                  low: data.counts.pastLimit,
                  spare: st.spare ?? 0,
                })}
              </Text>
              <Pressable
                style={s.addBtn}
                onPress={() => {
                  setForm(EMPTY_FORM);
                  setAddVisible(true);
                }}
                hitSlop={8}
              >
                <FontAwesome5 name="plus" size={13} color="#fff" />
              </Pressable>
            </View>

            <FilterChipRow<TyreFilter>
              value={filter}
              onChange={onFilterChange}
              items={[
                {
                  key: "pastLimit",
                  label: t("tyres.replacements.statusPastLimit"),
                  count: data.counts.pastLimit,
                  tone: "danger",
                },
                { key: "all", label: t("tyres.replacements.statusAll"), count: data.counts.tyres },
                { key: "mounted", label: t("tyres.replacements.statusMounted"), count: st.mounted ?? 0 },
                { key: "spare", label: t("tyres.replacements.statusSpare"), count: st.spare ?? 0 },
                { key: "retreading", label: t("tyres.replacements.statusRetreading"), count: st.retreading ?? 0 },
                { key: "rejected", label: t("tyres.replacements.statusRejected"), count: st.rejected ?? 0 },
                { key: "retired", label: t("tyres.replacements.statusRetired"), count: st.retired ?? 0 },
              ]}
            />

            <View style={s.searchWrap}>
              <FontAwesome5 name="search" size={12} color="#9CA3AF" style={{ marginRight: 8 }} />
              <TextInput
                value={tyreQuery}
                onChangeText={setTyreQuery}
                placeholder={t("tyres.replacements.searchTyres")}
                placeholderTextColor="#9CA3AF"
                style={s.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
          </>
        }
        renderItem={({ item }) => (
          <View style={s.rowWrap}>
            <TyreListRow
              tyre={item}
              right={
                data.lowTreadIds.has(item.tyre_id) ? (
                  <View style={s.flagPill}>
                    <Text style={s.flagPillText}>{t("tyres.replacements.needsChange")}</Text>
                  </View>
                ) : undefined
              }
              onPress={() => openTyre(item)}
            />
          </View>
        )}
        ListEmptyComponent={
          data.loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} />
          ) : (
            <Text style={s.empty}>{t("tyres.replacements.noTyres")}</Text>
          )
        }
      />

      <Modal
        visible={addVisible}
        animationType="slide"
        transparent
        onRequestClose={() => !submitting && setAddVisible(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={s.modalOverlay}>
            <View style={s.modalSheet}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>{t("tyres.addTyre.title")}</Text>
                <Pressable onPress={() => !submitting && setAddVisible(false)} style={{ padding: 4 }}>
                  <FontAwesome5 name="times" size={16} color="#6B7280" />
                </Pressable>
              </View>

              <ScrollView keyboardShouldPersistTaps="handled">
                {draft.pending && (
                  <DraftRestoreBar
                    savedAt={draft.savedAt}
                    onRestore={restoreDraft}
                    onDiscard={draft.discard}
                  />
                )}
                <Text style={s.label}>
                  {t("tyres.addTyre.serialNumber")} <Text style={{ color: "#EF4444" }}>*</Text>
                </Text>
                <TextInput
                  style={s.input}
                  value={form.tyre_serial_number}
                  onChangeText={(v) => setForm((f) => ({ ...f, tyre_serial_number: v }))}
                  placeholder={t("tyres.addTyre.serialPlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  editable={!submitting}
                />

                <Text style={s.label}>{t("tyres.addTyre.brand")}</Text>
                <TextInput
                  style={s.input}
                  value={form.tyre_brand}
                  onChangeText={(v) => setForm((f) => ({ ...f, tyre_brand: v }))}
                  placeholder={t("tyres.addTyre.brandPlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  editable={!submitting}
                />

                <Text style={s.label}>{t("tyres.addTyre.model")}</Text>
                <TextInput
                  style={s.input}
                  value={form.tyre_model}
                  onChangeText={(v) => setForm((f) => ({ ...f, tyre_model: v }))}
                  placeholder={t("tyres.addTyre.modelPlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  editable={!submitting}
                />

                <Text style={s.label}>{t("tyres.addTyre.grooves")}</Text>
                <View style={s.grooveRow}>
                  {[3, 4].map((n) => (
                    <Pressable
                      key={n}
                      style={[s.grooveBtn, Number(form.tyre_tread_count) === n && s.grooveBtnActive]}
                      disabled={submitting}
                      // Re-shapes the thickness cells; readings typed for the
                      // other groove count are dropped, not mis-assigned.
                      onPress={() =>
                        setForm((f) => ({
                          ...f,
                          tyre_tread_count: String(n),
                          intake_thickness:
                            f.intake_thickness.length === n ? f.intake_thickness : emptyThicknessCells(n),
                        }))
                      }
                    >
                      <Text
                        style={[
                          s.grooveBtnText,
                          Number(form.tyre_tread_count) === n && s.grooveBtnTextActive,
                        ]}
                      >
                        {n} grooves
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={s.label}>
                  {t("tyres.addTyre.thickness")} <Text style={{ color: "#DC2626" }}>*</Text>
                </Text>
                <ThicknessInputRow
                  values={form.intake_thickness}
                  onChange={(next) => setForm((f) => ({ ...f, intake_thickness: next }))}
                  editable={!submitting}
                  showGrooveLabels
                />
                <Text style={s.thicknessHint}>{t("tyres.addTyre.thicknessHint")}</Text>
                <TyreTreadProfile readings={form.intake_thickness} showUnevenWear={false} />

                <Text style={s.label}>{t("tyres.addTyre.boughtDate")}</Text>
                <TextInput
                  style={s.input}
                  value={form.tyre_bought_date}
                  onChangeText={(v) => setForm((f) => ({ ...f, tyre_bought_date: v }))}
                  placeholder={t("tyres.addTyre.boughtPlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  editable={!submitting}
                />

                <Text style={s.label}>{t("tyres.addTyre.timesRetreaded")}</Text>
                <Text style={[s.rowMeta, { marginBottom: 8 }]}>
                  0 = new tyre. 2+ covers any tyre retreaded twice or more.
                </Text>
                <RetreadCountSelector
                  value={Number(form.tyre_retread_count) || 0}
                  onChange={(n) => {
                    setForm((f) => ({ ...f, tyre_retread_count: String(n) }));
                    // Back to 0 means no sticker exists to show.
                    if (n === 0) setRetreadSticker([]);
                  }}
                  disabled={submitting}
                />

                {toRetreadBucket(Number(form.tyre_retread_count)) > 0 && (
                  <View style={{ marginTop: 14 }}>
                    <ImagePickerField
                      title={t("tyres.replacementForm.retreadStickerPhoto")}
                      required
                      icon={<FontAwesome5 name="camera" size={16} color="#B45309" />}
                      iconAccentLight="#FFFBEB"
                      maxItems={1}
                      value={retreadSticker}
                      onChange={setRetreadSticker}
                      disabled={submitting}
                    />
                  </View>
                )}

                <Pressable
                  style={[s.saveBtn, { marginTop: 20 }, submitting && { opacity: 0.6 }]}
                  onPress={submitAdd}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={s.saveText}>{t("tyres.addTyre.addButton")}</Text>
                  )}
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  subtitle: { flex: 1, fontSize: 13, fontWeight: "700", color: "#374151" },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  searchInput: { flex: 1, fontSize: 14, color: "#111827", padding: 0 },
  rowWrap: {
    marginHorizontal: 16,
    backgroundColor: "#fff",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
  },
  rowMeta: { fontSize: 11, fontWeight: "600", color: "#6B7280", marginTop: 2 },
  flagPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "#FFFBEB" },
  flagPillText: { fontSize: 10, fontWeight: "800", color: "#B45309" },
  empty: { textAlign: "center", paddingVertical: 20, color: "#9CA3AF", fontWeight: "600", fontSize: 12 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    maxHeight: "88%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  modalTitle: { fontSize: 17, fontWeight: "800", color: "#111827" },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  thicknessHint: { fontSize: 12, color: "#6B7280", marginTop: 6, marginBottom: 4 },
  grooveRow: { flexDirection: "row", gap: 10 },
  grooveBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
  },
  grooveBtnActive: { borderColor: "#111827", backgroundColor: "#fff" },
  grooveBtnText: { fontSize: 13, fontWeight: "700", color: "#9CA3AF" },
  grooveBtnTextActive: { color: "#111827" },
  saveBtn: { paddingVertical: 13, borderRadius: 12, alignItems: "center", backgroundColor: "#111827" },
  saveText: { fontWeight: "800", color: "#fff", fontSize: 14 },
});
