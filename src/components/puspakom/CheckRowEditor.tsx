// One check on a walk-around stop (spec screens 5–11 and the Data &
// validation page): OK/NG, tyre, brake or body & paint, each with its photo.
// Every change is saved on the phone straight away (see offline/puspakomDrafts).

import { FontAwesome5 } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Alert, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { PspCheckDef, PspDamageType, PspNgReason, PspSettings, PspTag } from "../../api/puspakom";
import { useI18n } from "../../i18n/i18n-ctx";
import { keepPhoto, LocalAnswer, LocalDamage, LocalPhoto } from "../../offline/puspakomDrafts";
import { TAG_TONE, tyreFieldTags } from "../../utils/puspakom";
import { localDone, localTag, needsAttention, photoUri } from "../../utils/puspakomLocal";
import { pickImage } from "../ImagePicker";
import BusDrawing, { DrawingView } from "./BusDrawing";
import Pill from "./Pill";

const ORANGE = "#C4501A";
const NG_REASONS: PspNgReason[] = ["NOT_WORKING", "FLICKERING", "CRACKED", "LOOSE", "OTHER"];
const DAMAGE_TYPES: PspDamageType[] = ["SCRATCH", "DENT", "CRACK", "PAINT"];

type Props = {
  def: PspCheckDef;
  no: number;
  answer: LocalAnswer | undefined;
  current: boolean;
  settings: PspSettings;
  view: DrawingView | null;
  readOnly?: boolean;
  onChange: (patch: Partial<LocalAnswer>) => void;
};

export function rowColor(def: PspCheckDef, a: LocalAnswer | undefined, current: boolean, s: PspSettings) {
  if (localDone(def, a)) return needsAttention(def, a, s) ? "#DC2626" : "#16A34A";
  return current ? ORANGE : "#9CA3AF";
}

/** Where on the bus a tap landed, as a starting point the technician can edit. */
function autoWhere(view: DrawingView | null, x: number, y: number, t: (k: string) => string): string {
  const v = y < 35 ? "upper" : y < 70 ? "middle" : "lower edge";
  if (view === "left" || view === "right") {
    const front = view === "left" ? x < 33 : x > 66;
    const rear = view === "left" ? x > 66 : x < 33;
    return `${front ? "Front" : rear ? "Rear" : "Middle"} panel, ${v}`;
  }
  const h = x < 33 ? "Left" : x > 66 ? "Right" : "Centre";
  return `${h}, ${v}`;
}

export default function CheckRowEditor({ def, no, answer: a, current, settings, view, readOnly, onChange }: Props) {
  const { t } = useI18n();
  const done = localDone(def, a);
  const tag = localTag(def, a, settings);
  const color = rowColor(def, a, current, settings);
  const [zoom, setZoom] = useState<string | null>(null);

  const takePhoto = async (onSaved: (p: LocalPhoto) => void) => {
    const m = await pickImage(true);
    if (!m) return;
    onSaved({ localUri: await keepPhoto(m.localUri), s3_key: null, url: null });
  };

  const photoMenu = (p: LocalPhoto | null, set: (p: LocalPhoto | null) => void) => {
    if (readOnly) {
      const u = photoUri(p);
      if (u) setZoom(u);
      return;
    }
    if (!p) return takePhoto(set);
    Alert.alert(def.label, undefined, [
      { text: t("puspakom.tech.viewPhoto"), onPress: () => setZoom(photoUri(p)) },
      { text: t("puspakom.tech.retake"), onPress: () => takePhoto(set) },
      { text: t("puspakom.tech.deletePhoto"), style: "destructive", onPress: () => set(null) },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  return (
    <View style={[s.card, current && !done && { borderColor: ORANGE, borderWidth: 1.5 }, readOnly && { opacity: 0.95 }]}>
      <View style={s.head}>
        <View style={[s.num, { backgroundColor: done ? color : "#fff", borderColor: color }]}>
          {done && !needsAttention(def, a, settings) ? (
            <FontAwesome5 name="check" size={9} color="#fff" />
          ) : (
            <Text style={[s.numText, { color: done ? "#fff" : color }]}>{no}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{def.label}</Text>
          <Text style={s.okIf}>
            <Text style={s.okIfLbl}>{def.answer_type === "BODY" ? "" : `${t("puspakom.checklist.okIf")}: `}</Text>
            {def.ok_if}
          </Text>
        </View>
        <PhotoButton photo={a?.photo ?? null} hint={def.photo_hint} onPress={() => photoMenu(a?.photo ?? null, (p) => onChange({ photo: p }))} />
      </View>

      {def.answer_type === "OK_NG" && (
        <>
          <View style={s.pair}>
            <ChoiceBtn
              label={`✓ ${t("puspakom.tags.OK")}`}
              on={a?.answer === "OK"}
              color="#16A34A"
              disabled={readOnly}
              onPress={() => onChange({ answer: "OK", ng_reason: null, note: null })}
            />
            <ChoiceBtn
              label={`✕ ${t("puspakom.tags.NG")}`}
              on={a?.answer === "NG"}
              color="#DC2626"
              disabled={readOnly}
              onPress={() => onChange({ answer: "NG" })}
            />
          </View>
          {a?.answer === "NG" && (
            <View style={s.ngBox}>
              <Text style={s.ngTitle}>{t("puspakom.tech.whatsWrong")}</Text>
              <View style={s.chips}>
                {NG_REASONS.map((r) => (
                  <Pressable
                    key={r}
                    disabled={readOnly}
                    onPress={() => onChange({ ng_reason: r })}
                    style={[s.chip, a.ng_reason === r && s.chipOnRed]}
                  >
                    <Text style={[s.chipText, a.ng_reason === r && { color: "#B91C1C" }]}>{t(`puspakom.ngReason.${r}`)}</Text>
                  </Pressable>
                ))}
              </View>
              <DebouncedText
                value={a.note ?? ""}
                onCommit={(v) => onChange({ note: v || null })}
                placeholder={a.ng_reason === "OTHER" ? t("puspakom.tech.notePhRequired") : t("puspakom.tech.notePh")}
                maxLength={200}
                editable={!readOnly}
              />
            </View>
          )}
        </>
      )}

      {def.answer_type === "TYRE" && (
        <View style={s.pair}>
          <NumField
            label={t("puspakom.tech.tread")}
            unit="mm"
            value={a?.tread_mm ?? null}
            min={0}
            max={25}
            decimals={1}
            tag={tyreFieldTags(a as any, settings).tread}
            readOnly={readOnly}
            onCommit={(v) => onChange({ tread_mm: v })}
          />
          <NumField
            label={t("puspakom.tech.pressure")}
            unit="psi"
            value={a?.pressure_psi ?? null}
            min={0}
            max={200}
            decimals={0}
            tag={tyreFieldTags(a as any, settings).pressure}
            readOnly={readOnly}
            onCommit={(v) => onChange({ pressure_psi: v })}
          />
        </View>
      )}

      {def.answer_type === "BRAKE" && (
        <View style={s.pair}>
          <NumField
            label={t("puspakom.tech.pad")}
            unit="mm"
            value={a?.pad_mm ?? null}
            min={0}
            max={30}
            decimals={1}
            tag={tag}
            readOnly={readOnly}
            onCommit={(v) => onChange({ pad_mm: v })}
          />
          <View style={{ flex: 1 }} />
        </View>
      )}

      {def.answer_type === "BODY" && (
        <BodyDamage
          answer={a}
          view={view}
          readOnly={readOnly}
          onChange={onChange}
          takePhoto={takePhoto}
          onZoom={setZoom}
        />
      )}

      {!!a?.entered_by && readOnly && <Text style={s.by}>{a.entered_by}</Text>}

      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable style={s.zoomBg} onPress={() => setZoom(null)}>
          {!!zoom && <Image source={{ uri: zoom }} style={s.zoomImg} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

function PhotoButton({ photo, hint, onPress }: { photo: LocalPhoto | null; hint: string; onPress: () => void }) {
  const { t } = useI18n();
  const uri = photoUri(photo);
  return (
    <Pressable onPress={onPress} style={[s.photoBtn, !uri && s.photoEmpty]} accessibilityLabel={hint}>
      {uri ? (
        <>
          <Image source={{ uri }} style={s.photoImg} />
          <View style={s.photoTick}>
            <FontAwesome5 name={photo?.s3_key ? "check" : "cloud-upload-alt"} size={8} color="#fff" />
          </View>
        </>
      ) : (
        <>
          <FontAwesome5 name="camera" size={15} color={ORANGE} />
          <Text style={s.photoText}>{t("puspakom.tech.takePhoto")}</Text>
        </>
      )}
    </Pressable>
  );
}

function ChoiceBtn({ label, on, color, onPress, disabled }: { label: string; on: boolean; color: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[s.choice, on ? { backgroundColor: color, borderColor: color } : { borderColor: "#E5E7EB" }]}
    >
      <Text style={[s.choiceText, { color: on ? "#fff" : color }]}>{label}</Text>
    </Pressable>
  );
}

/** Numeric field: refuses out-of-range numbers with "Check the number". */
function NumField({
  label,
  unit,
  value,
  min,
  max,
  decimals,
  tag,
  readOnly,
  onCommit,
}: {
  label: string;
  unit: string;
  value: number | null;
  min: number;
  max: number;
  decimals: number;
  tag: PspTag | null;
  readOnly?: boolean;
  onCommit: (v: number | null) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(value == null ? "" : String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);

  const commit = (raw: string) => {
    const s0 = raw.replace(",", ".").trim();
    if (s0 === "") {
      setBad(false);
      if (value != null) onCommit(null);
      return;
    }
    const n = Number(s0);
    const okDecimals = decimals === 0 ? Number.isInteger(n) : Math.round(n * 10) === n * 10;
    if (!Number.isFinite(n) || n < min || n > max || !okDecimals) {
      setBad(true);
      return;
    }
    setBad(false);
    if (n !== value) onCommit(n);
  };

  return (
    <View style={{ flex: 1 }}>
      <Text style={s.numLabel}>{label}</Text>
      <View style={s.numRow}>
        <View style={[s.numBox, value == null && !readOnly && { borderColor: ORANGE }, bad && { borderColor: "#DC2626" }]}>
          <TextInput
            value={text}
            editable={!readOnly}
            onChangeText={(v) => {
              setText(v);
              setBad(false);
            }}
            onEndEditing={() => commit(text)}
            onBlur={() => commit(text)}
            keyboardType={decimals ? "decimal-pad" : "number-pad"}
            placeholder={t("puspakom.tech.tap")}
            placeholderTextColor="#D1D5DB"
            style={s.numInput}
            maxLength={5}
          />
          <Text style={s.unit}>{unit}</Text>
        </View>
        {tag && <Pill small label={t(`puspakom.tags.${tag}`)} tone={TAG_TONE[tag]} />}
      </View>
      {bad && <Text style={s.bad}>{t("puspakom.tech.checkNumber")}</Text>}
    </View>
  );
}

function DebouncedText({
  value,
  onCommit,
  placeholder,
  maxLength,
  editable = true,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder: string;
  maxLength: number;
  editable?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const id = setTimeout(() => onCommit(text.trim()), 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onBlur={() => text !== value && onCommit(text.trim())}
      placeholder={placeholder}
      placeholderTextColor="#9CA3AF"
      maxLength={maxLength}
      editable={editable}
      multiline
      style={s.note}
    />
  );
}

function BodyDamage({
  answer: a,
  view,
  readOnly,
  onChange,
  takePhoto,
  onZoom,
}: {
  answer: LocalAnswer | undefined;
  view: DrawingView | null;
  readOnly?: boolean;
  onChange: (patch: Partial<LocalAnswer>) => void;
  takePhoto: (onSaved: (p: LocalPhoto) => void) => Promise<void>;
  onZoom: (u: string) => void;
}) {
  const { t } = useI18n();
  const damages = a?.damages ?? [];
  const [placing, setPlacing] = useState(false);
  const isDamage = a?.answer === "DAMAGE";

  const setDamages = (list: LocalDamage[]) => onChange({ answer: "DAMAGE", damages: list });
  const patchDamage = (no: number, patch: Partial<LocalDamage>) =>
    setDamages(damages.map((d) => (d.no === no ? { ...d, ...patch } : d)));

  const noDamage = () => {
    if (!damages.length) return onChange({ answer: "NO_DAMAGE", damages: [] });
    Alert.alert(t("puspakom.tech.clearMarksTitle"), t("puspakom.tech.clearMarksBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("puspakom.tech.clearMarks"), style: "destructive", onPress: () => onChange({ answer: "NO_DAMAGE", damages: [] }) },
    ]);
  };

  return (
    <>
      <View style={s.pair}>
        <ChoiceBtn label={t("puspakom.checklist.noDamage")} on={a?.answer === "NO_DAMAGE"} color="#16A34A" disabled={readOnly} onPress={noDamage} />
        <ChoiceBtn
          label={damages.length ? t("puspakom.tech.damageMarked", { count: damages.length }) : t("puspakom.tech.markDamage")}
          on={isDamage}
          color="#DC2626"
          disabled={readOnly}
          onPress={() => {
            onChange({ answer: "DAMAGE" });
            if (!damages.length) setPlacing(true);
          }}
        />
      </View>
      {isDamage && (
        <View style={s.damageBox}>
          {view && (
            <>
              {!readOnly && (
                <Text style={s.damageHint}>{placing || !damages.length ? t("puspakom.tech.tapDrawing") : " "}</Text>
              )}
              <BusDrawing
                view={view}
                pins={damages.map((d) => ({ key: String(d.no), label: String(d.no), x: d.x_pct, y: d.y_pct, color: "#DC2626" }))}
                onPlace={
                  !readOnly && (placing || !damages.length)
                    ? (x, y) => {
                        const no = damages.reduce((m, d) => Math.max(m, d.no), 0) + 1;
                        setDamages([...damages, { no, x_pct: Math.round(x * 10) / 10, y_pct: Math.round(y * 10) / 10, where: autoWhere(view, x, y, t), type: null, photo: null }]);
                        setPlacing(false);
                      }
                    : undefined
                }
              />
            </>
          )}
          {damages.map((d) => (
            <View key={d.no} style={s.damageItem}>
              <View style={s.damageHead}>
                <View style={s.damageNo}>
                  <Text style={s.damageNoText}>{d.no}</Text>
                </View>
                <TextInput
                  value={d.where}
                  editable={!readOnly}
                  onChangeText={(v) => patchDamage(d.no, { where: v })}
                  placeholder={t("puspakom.tech.wherePh")}
                  placeholderTextColor="#9CA3AF"
                  maxLength={80}
                  style={s.whereInput}
                />
                <PhotoButton
                  photo={d.photo}
                  hint={t("puspakom.tech.closeUp")}
                  onPress={() => {
                    const u = photoUri(d.photo);
                    if (readOnly) return u && onZoom(u);
                    takePhoto((p) => patchDamage(d.no, { photo: p }));
                  }}
                />
                {!readOnly && (
                  <Pressable hitSlop={8} onPress={() => setDamages(damages.filter((x) => x.no !== d.no))}>
                    <FontAwesome5 name="times" size={13} color="#9CA3AF" />
                  </Pressable>
                )}
              </View>
              <View style={s.chips}>
                {DAMAGE_TYPES.map((ty) => (
                  <Pressable
                    key={ty}
                    disabled={readOnly}
                    onPress={() => patchDamage(d.no, { type: ty })}
                    style={[s.chip, d.type === ty && s.chipOnRed]}
                  >
                    <Text style={[s.chipText, d.type === ty && { color: "#B91C1C" }]}>{t(`puspakom.damageType.${ty}`)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          {!readOnly && damages.length > 0 && (
            <Pressable style={s.another} onPress={() => setPlacing(true)}>
              <Text style={s.anotherText}>+ {t("puspakom.tech.markAnother")}</Text>
            </Pressable>
          )}
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 10 },
  head: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  num: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1 },
  numText: { fontSize: 11, fontWeight: "800" },
  label: { fontSize: 15, fontWeight: "800", color: "#111827" },
  okIf: { fontSize: 12, color: "#6B7280", marginTop: 2, lineHeight: 16 },
  okIfLbl: { fontWeight: "800", color: "#15803D" },
  photoBtn: { width: 58, height: 58, borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  photoEmpty: { borderWidth: 1.5, borderStyle: "dashed", borderColor: ORANGE, backgroundColor: "#FFF7ED" },
  photoImg: { width: "100%", height: "100%" },
  photoText: { fontSize: 9, fontWeight: "700", color: ORANGE, marginTop: 3, textAlign: "center" },
  photoTick: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
  },
  pair: { flexDirection: "row", gap: 10, marginTop: 10 },
  choice: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  choiceText: { fontSize: 14, fontWeight: "800" },
  ngBox: { backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10, marginTop: 8 },
  ngTitle: { fontSize: 12, fontWeight: "800", color: "#991B1B", marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: { borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipOnRed: { borderColor: "#DC2626", backgroundColor: "#FEE2E2" },
  chipText: { fontSize: 12, fontWeight: "700", color: "#374151" },
  note: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
    fontSize: 13,
    minHeight: 40,
    color: "#111827",
  },
  numLabel: { fontSize: 10, fontWeight: "800", color: "#6B7280", letterSpacing: 0.4, marginBottom: 4 },
  numRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  numBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    paddingHorizontal: 10,
    minWidth: 92,
  },
  numInput: { flex: 1, fontSize: 18, fontWeight: "800", color: "#111827", paddingVertical: 8, minWidth: 40 },
  unit: { fontSize: 12, color: "#9CA3AF", marginLeft: 4 },
  bad: { fontSize: 11, color: "#DC2626", fontWeight: "700", marginTop: 3 },
  by: { fontSize: 11, color: "#9CA3AF", marginTop: 8 },
  damageBox: { backgroundColor: "#FEF2F2", borderRadius: 10, borderWidth: 1, borderColor: "#FECACA", padding: 10, marginTop: 8 },
  damageHint: { fontSize: 12, fontWeight: "800", color: "#991B1B", marginBottom: 4 },
  damageItem: { backgroundColor: "#fff", borderRadius: 10, padding: 8, marginTop: 8, borderWidth: 1, borderColor: "#FECACA" },
  damageHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  damageNo: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" },
  damageNoText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  whereInput: { flex: 1, fontSize: 13, fontWeight: "700", color: "#111827", paddingVertical: 6 },
  another: { borderWidth: 1, borderStyle: "dashed", borderColor: "#FCA5A5", borderRadius: 10, paddingVertical: 10, alignItems: "center", marginTop: 8 },
  anotherText: { color: "#B91C1C", fontWeight: "800", fontSize: 13 },
  zoomBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  zoomImg: { width: "100%", height: "80%" },
});
