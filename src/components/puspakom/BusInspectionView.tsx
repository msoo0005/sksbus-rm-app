// Bus inspection (Fleet Manager screens 4, 4a, 4a+, 4b, 3c; R&M Manager view
// only). One screen per bus: its booking, the technician's pre-inspection or
// re-check, the result, and the chronology.

import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PspAnswer, PspCheckDef, PspDetail, PspEvent, puspakomApi, uploadPuspakomPhoto } from "../../api/puspakom";
import { useI18n } from "../../i18n/i18n-ctx";
import {
  ATTENTION_TAGS,
  TAG_TONE,
  addDays,
  addMonths,
  busLabel,
  fmtDate,
  fmtDateTime,
  fmtDayDate,
  mytDate,
  mytInstant,
} from "../../utils/puspakom";
import { ROLE_COLORS } from "../../utils/roles";
import { LocalMedia, pickImage } from "../ImagePicker";
import Sheet from "../Sheet";
import VerificationModal from "../VerificationModal";
import DateTimeField from "./DateTimeField";
import Pill from "./Pill";
import PuspakomMark from "./PuspakomMark";
import { FieldLabel, InfoRow, Section } from "./Section";
import StatusPill from "./StatusPill";

const FM = ROLE_COLORS.fleet_manager.accent;

type Props = { busId?: string; inspectionId?: number };

export default function BusInspectionView({ busId, inspectionId }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const [data, setData] = useState<PspDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(busId ? await puspakomApi.bus(busId) : await puspakomApi.inspection(inspectionId!));
    } catch (e: any) {
      setError(e?.message ?? t("puspakom.loadError"));
    }
  }, [busId, inspectionId, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!data) {
    return (
      <View style={s.center}>
        {error ? <Text style={s.errorText}>{error}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const insp = data.inspection;
  const isOpen = !!insp && !insp.result;
  const bus = data.bus;

  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      keyboardShouldPersistTaps="handled"
    >
      <Section>
        <PuspakomMark />
        <Text style={s.plate}>
          {bus.bus_id}
          {!!bus.bus_ev_no && <Text style={s.ev}> ({bus.bus_ev_no})</Text>}
        </Text>
        {!!bus.bus_model && <Text style={s.model}>{bus.bus_model}</Text>}
        <StatusPill status={data.state.status} style={{ marginTop: 8 }} />
      </Section>

      {isOpen ? (
        <OpenInspection data={data} onChanged={load} />
      ) : (
        <NoOpenInspection data={data} onRegister={() => router.push(`/puspakom/register?bus_id=${encodeURIComponent(bus.bus_id)}` as any)} />
      )}

      <Chronology events={isOpen ? data.events : data.events.filter((e) => e.type === "RESULT_PASSED" || e.type === "RESULT_FAILED").slice(-1)} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------

function NoOpenInspection({ data, onRegister }: { data: PspDetail; onRegister: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const last = data.inspection;
  return (
    <>
      <Section icon="calendar-alt" title={t("puspakom.bus.booking")}>
        <Text style={s.muted}>{t("puspakom.bus.noBooking")}</Text>
        <InfoRow
          label={t("puspakom.bus.due")}
          value={
            data.state.next_due
              ? t("puspakom.bus.dueLine", { due: fmtDate(data.state.next_due), last: fmtDate(data.state.last_passed) })
              : t("puspakom.noPassYet")
          }
          last
        />
        {data.can_edit && (
          <Pressable style={[s.primary, { backgroundColor: FM, marginTop: 12 }]} onPress={onRegister}>
            <FontAwesome5 name="plus" size={13} color="#fff" />
            <Text style={s.primaryText}>{t("puspakom.register")}</Text>
          </Pressable>
        )}
      </Section>
      {last?.result && (
        <Section icon="stamp" title={t("puspakom.bus.lastResult")}>
          <InfoRow label={t("puspakom.bus.type")} value={t(`puspakom.typeLong.${last.inspection_type}`)} />
          <InfoRow label={t("puspakom.bus.date")} value={fmtDateTime(last.scheduled_at)} />
          <InfoRow
            label={t("puspakom.bus.result")}
            value={t("puspakom.bus.resultLine", {
              result: t(last.result === "PASSED" ? "puspakom.bus.passed" : "puspakom.bus.failed"),
              date: fmtDayDate(last.result_date),
            })}
            last={last.result !== "PASSED"}
          />
          {last.result === "PASSED" && (
            <Pressable style={s.secondaryBtn} onPress={() => router.push(`/puspakom/report/${last.root_inspection_id}` as any)}>
              <Text style={[s.secondaryBtnText, { color: FM }]}>{t("puspakom.reports.viewReport")}</Text>
              <FontAwesome5 name="chevron-right" size={11} color={FM} />
            </Pressable>
          )}
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function OpenInspection({ data, onChanged }: { data: PspDetail; onChanged: () => void }) {
  const router = useRouter();
  const { t } = useI18n();
  const insp = data.inspection!;
  const isRe = insp.inspection_type === "REINSPECTION";
  const parent = isRe ? data.chain.find((c) => c.inspection_id === insp.parent_inspection_id) ?? null : null;
  const failedItems = isRe ? data.failed_items.filter((f) => f.inspection_id === insp.parent_inspection_id) : [];
  const recheck = isRe ? data.rechecks.find((r) => r.inspection_id === insp.inspection_id) ?? null : null;
  const pre = data.precheck;
  const parentSlips = parent ? data.slips.filter((m) => m.inspection_id === parent.inspection_id) : [];

  return (
    <>
      <Section icon="calendar-alt" title={t("puspakom.bus.booking")}>
        <InfoRow label={t("puspakom.bus.type")} value={t(`puspakom.typeLong.${insp.inspection_type}`)} />
        <InfoRow label={t("puspakom.bus.date")} value={fmtDateTime(insp.scheduled_at)} />
        <InfoRow label={t("puspakom.bus.bookingRef")} value={insp.booking_ref ?? "—"} />
        <InfoRow
          label={t("puspakom.bus.due")}
          value={
            data.state.next_due
              ? t("puspakom.bus.dueLine", { due: fmtDate(data.state.next_due), last: fmtDate(data.state.last_passed) })
              : t("puspakom.noPassYet")
          }
          last={!data.can_edit}
        />
        {data.can_edit && (
          <Pressable onPress={() => router.push(`/puspakom/register?inspection_id=${insp.inspection_id}` as any)} style={{ paddingTop: 10 }}>
            <Text style={[s.link, { color: FM }]}>{t("puspakom.bus.editBooking")}</Text>
          </Pressable>
        )}
      </Section>

      {isRe && parent ? (
        <>
          <View style={s.failedPanel}>
            <Text style={s.failedTitle}>{t("puspakom.bus.failedAt", { date: fmtDayDate(parent.result_date) })}</Text>
            {failedItems.map((f) => (
              <View key={f.check_id} style={s.failedItem}>
                <Text style={s.failedItemTitle}>
                  {f.check_id} {f.label}
                </Text>
                <Text style={s.failedFound}>{f.puspakom_found}</Text>
              </View>
            ))}
            {parentSlips.length > 0 && <PhotoRow urls={parentSlips.map((m) => m.url)} />}
          </View>
          <Section icon="tools" title={t("puspakom.bus.recheck")}>
            {recheck?.submitted_at ? (
              <>
                <InfoRow label={t("puspakom.bus.technician")} value={recheck.submitted_by ?? "—"} />
                <InfoRow label={t("puspakom.bus.completed")} value={fmtDateTime(recheck.submitted_at)} last />
              </>
            ) : (
              <Text style={s.muted}>
                {recheck && recheck.done > 0
                  ? t("puspakom.bus.recheckProgress", { done: recheck.done, total: recheck.total })
                  : t("puspakom.bus.recheckWaiting")}
              </Text>
            )}
            {failedItems
              .filter((f) => f.fixed_text || f.fix_photos.length)
              .map((f) => (
                <View key={f.check_id} style={s.fixItem}>
                  <Text style={s.fixTitle}>
                    {f.check_id} {f.label}
                  </Text>
                  {!!f.fixed_text && <Text style={s.fixText}>{f.fixed_text}</Text>}
                  <PhotoRow urls={f.fix_photos.map((p) => p.url)} />
                </View>
              ))}
          </Section>
        </>
      ) : (
        <Section icon="clipboard-list" title={t("puspakom.bus.preInspection")}>
          {pre?.submitted_at ? (
            <>
              <InfoRow label={t("puspakom.bus.technician")} value={pre.submitted_by ?? "—"} />
              <InfoRow label={t("puspakom.bus.completed")} value={fmtDateTime(pre.submitted_at)} />
              <InfoRow
                label={t("puspakom.bus.checks")}
                value={t("puspakom.bus.checksLine", { done: pre.done, total: pre.total, attention: pre.needs_attention.length })}
                last
              />
              <Pressable
                style={s.secondaryBtn}
                onPress={() => router.push(`/puspakom/checklist/${insp.root_inspection_id}` as any)}
              >
                <Text style={[s.secondaryBtnText, { color: FM }]}>{t("puspakom.bus.viewChecklist")}</Text>
                <FontAwesome5 name="chevron-right" size={11} color={FM} />
              </Pressable>
            </>
          ) : (
            <Text style={s.muted}>
              {pre && pre.answers.length > 0
                ? t("puspakom.bus.inProgress", { done: pre.done, total: pre.total })
                : t("puspakom.bus.waitingTech")}
            </Text>
          )}
        </Section>
      )}

      <ResultSection data={data} onSaved={onChanged} />
    </>
  );
}

// ---------------------------------------------------------------------------

type FailedPick = { check_id: string; found: string };

function ResultSection({ data, onSaved }: { data: PspDetail; onSaved: () => void }) {
  const { t } = useI18n();
  const insp = data.inspection!;
  const today = mytDate(data.now);
  const inspDate = mytDate(insp.scheduled_at);
  const reached = today >= inspDate;
  const timePassed = new Date(data.now).getTime() >= new Date(insp.scheduled_at).getTime();
  const root = data.chain.find((c) => c.inspection_id === insp.root_inspection_id);
  const movesDue = root?.inspection_type === "PERIODIC";

  const [result, setResult] = useState<"PASSED" | "FAILED" | null>(null);
  const [resultDate, setResultDate] = useState(inspDate <= today ? inspDate : today);
  const [failed, setFailed] = useState<FailedPick[]>([]);
  const [slips, setSlips] = useState<LocalMedia[]>([]);
  const [reDate, setReDate] = useState(addDays(today, 7));
  const [reTime, setReTime] = useState({ h: 9, m: 0 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [signing, setSigning] = useState(false);
  const [saving, setSaving] = useState(false);

  const defs = data.defs;
  const defById = useMemo(() => new Map((defs?.checks ?? []).map((c) => [c.check_id, c])), [defs]);

  if (!data.can_edit) {
    return (
      <Section icon="stamp" title={t("puspakom.bus.result")}>
        <Text style={s.muted}>{timePassed ? t("puspakom.bus.waitingFm") : t("puspakom.bus.waitingInspection")}</Text>
      </Section>
    );
  }

  const failValid =
    failed.length > 0 && failed.every((f) => f.found.trim().length > 0) && slips.length > 0 && reDate > resultDate;
  const valid = result === "PASSED" || (result === "FAILED" && failValid);

  const addSlip = () => {
    Alert.alert(t("puspakom.bus.photoSource"), undefined, [
      { text: t("puspakom.bus.takePhoto"), onPress: async () => {
        const m = await pickImage(true);
        if (m) setSlips((x) => [...x, m]);
      } },
      { text: t("puspakom.bus.choosePhoto"), onPress: async () => {
        const m = await pickImage(false);
        if (m) setSlips((x) => [...x, m]);
      } },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const save = async ({ selfie, name }: { selfie: LocalMedia; name: string }) => {
    if (!result) return;
    setSaving(true);
    try {
      const busId = data.bus.bus_id;
      const selfieKey = await uploadPuspakomPhoto(busId, "selfie", selfie);
      const slipKeys: string[] = [];
      for (const m of slips) slipKeys.push(await uploadPuspakomPhoto(busId, "slip", m));
      await puspakomApi.recordResult(insp.inspection_id, {
        result,
        result_date: resultDate,
        slip_keys: slipKeys,
        verified_name: name,
        selfie_s3_key: selfieKey,
        ...(result === "FAILED"
          ? {
              failed: failed.map((f) => ({ check_id: f.check_id, puspakom_found: f.found.trim() })),
              reinspection: { scheduled_at: mytInstant(reDate, reTime.h, reTime.m) },
            }
          : {}),
      });
      setSigning(false);
      setSaving(false);
      Alert.alert(result === "PASSED" ? t("puspakom.bus.savedPass") : t("puspakom.bus.savedFail"));
      onSaved();
    } catch (e: any) {
      setSaving(false);
      Alert.alert(t("common.error"), e?.message ?? "");
    }
  };

  const busName = busLabel(data.bus.bus_id, data.bus.bus_ev_no);

  return (
    <Section icon="stamp" title={t("puspakom.bus.result")}>
      <Text style={s.muted}>{t("puspakom.bus.resultIntro")}</Text>
      <View style={s.resultRow}>
        <ResultCard
          kind="PASSED"
          selected={result === "PASSED"}
          disabled={!reached}
          onPress={() => setResult("PASSED")}
        />
        <ResultCard
          kind="FAILED"
          selected={result === "FAILED"}
          disabled={!reached}
          onPress={() => setResult("FAILED")}
        />
      </View>
      {!reached ? (
        <Text style={s.note}>{t("puspakom.bus.availableFrom", { date: fmtDayDate(inspDate) })}</Text>
      ) : !result ? (
        <Text style={s.note}>{t("puspakom.bus.resultHelp")}</Text>
      ) : null}

      {result && (
        <>
          <View style={{ marginTop: 12 }}>
            <DateTimeField
              mode="date"
              label={t("puspakom.bus.resultDate")}
              value={resultDate}
              onChange={setResultDate}
              maximumDate={today}
            />
          </View>
        </>
      )}

      {result === "PASSED" && (
        <>
          {movesDue ? (
            <View style={s.nextDue}>
              <Text style={s.nextDueLabel}>{t("puspakom.bus.nextDue")}</Text>
              <Text style={s.nextDueValue}>{fmtDate(addMonths(resultDate, data.settings.cycleMonths))}</Text>
              <Text style={s.nextDueHint}>{t("puspakom.bus.nextDueAuto")}</Text>
            </View>
          ) : (
            <Text style={s.note}>{t("puspakom.bus.specialNoDue")}</Text>
          )}
          <FieldLabel>{t("puspakom.bus.slipOptional")}</FieldLabel>
          <SlipPicker slips={slips} onAdd={addSlip} onRemove={(i) => setSlips(slips.filter((_, j) => j !== i))} />
        </>
      )}

      {result === "FAILED" && (
        <>
          <FieldLabel tone="danger">{t("puspakom.bus.failedChecks")}</FieldLabel>
          <Text style={s.hint}>{t("puspakom.bus.failedChecksHint")}</Text>
          {failed.map((f) => {
            const def = defById.get(f.check_id);
            const ans = data.precheck?.answers.find((a) => a.check_id === f.check_id);
            return (
              <View key={f.check_id} style={s.failedCard}>
                <View style={s.failedCardHead}>
                  <View style={s.checkIdBadge}>
                    <Text style={s.checkIdText}>{f.check_id}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.failedCardTitle}>{def?.label ?? f.check_id}</Text>
                    {def && <Text style={s.failedCardMeta}>{checkMeta(def, ans, data, t)}</Text>}
                  </View>
                  <Pressable hitSlop={10} onPress={() => setFailed(failed.filter((x) => x.check_id !== f.check_id))}>
                    <FontAwesome5 name="times" size={13} color="#6B7280" />
                  </Pressable>
                </View>
                <Text style={s.foundLabel}>{t("puspakom.bus.whatFound")}</Text>
                <TextInput
                  value={f.found}
                  onChangeText={(v) => setFailed(failed.map((x) => (x.check_id === f.check_id ? { ...x, found: v } : x)))}
                  placeholder={t("puspakom.bus.whatFoundPh")}
                  placeholderTextColor="#9CA3AF"
                  multiline
                  maxLength={300}
                  style={s.foundInput}
                />
              </View>
            );
          })}
          <Pressable style={s.addFailed} onPress={() => setPickerOpen(true)}>
            <FontAwesome5 name="plus" size={12} color="#B91C1C" />
            <Text style={s.addFailedText}>{t("puspakom.bus.addFailed")}</Text>
          </Pressable>

          <FieldLabel tone="danger">{t("puspakom.bus.slip")}</FieldLabel>
          <SlipPicker slips={slips} onAdd={addSlip} onRemove={(i) => setSlips(slips.filter((_, j) => j !== i))} />

          <View style={s.reBox}>
            <View style={s.reHead}>
              <FontAwesome5 name="calendar-plus" size={13} color="#B91C1C" />
              <Text style={s.reTitle}>{t("puspakom.bus.bookRe")}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <DateTimeField mode="date" label={t("puspakom.form.date")} value={reDate} onChange={setReDate} minimumDate={addDays(resultDate, 1)} />
              <DateTimeField mode="time" label={t("puspakom.form.time")} value={reTime} onChange={setReTime} step={15} />
            </View>
            <Text style={s.reHint}>{t("puspakom.bus.reHint")}</Text>
          </View>
        </>
      )}

      <Pressable
        disabled={!valid || saving}
        onPress={() => setSigning(true)}
        style={[s.primary, { backgroundColor: FM, marginTop: 16 }, (!valid || saving) && s.primaryDisabled]}
      >
        <Text style={[s.primaryText, (!valid || saving) && { color: "#6B7280" }]}>
          {!result ? t("puspakom.bus.chooseResult") : result === "PASSED" ? t("puspakom.bus.saveResult") : t("puspakom.bus.saveFail")}
        </Text>
      </Pressable>

      {defs && (
        <FailedChecksSheet
          visible={pickerOpen}
          checks={defs.checks}
          stops={defs.stops}
          answers={data.precheck?.answers ?? []}
          picked={failed.map((f) => f.check_id)}
          onClose={() => setPickerOpen(false)}
          onAdd={(ids) => {
            const keep = failed.filter((f) => ids.includes(f.check_id));
            const added = ids.filter((id) => !failed.some((f) => f.check_id === id)).map((id) => ({ check_id: id, found: "" }));
            setFailed([...keep, ...added]);
            setPickerOpen(false);
          }}
        />
      )}

      <VerificationModal
        visible={signing}
        title={t("puspakom.bus.signTitle")}
        message={result === "FAILED" ? t("puspakom.bus.signFail", { bus: busName }) : t("puspakom.bus.signPass", { bus: busName })}
        confirmLabel={result === "FAILED" ? t("puspakom.bus.saveFail") : t("puspakom.bus.saveResult")}
        submitting={saving}
        onCancel={() => !saving && setSigning(false)}
        onConfirm={save}
      />
    </Section>
  );
}

function ResultCard({ kind, selected, disabled, onPress }: { kind: "PASSED" | "FAILED"; selected: boolean; disabled: boolean; onPress: () => void }) {
  const { t } = useI18n();
  const pass = kind === "PASSED";
  const color = pass ? "#15803D" : "#B91C1C";
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        s.resultCard,
        selected && { borderColor: color, backgroundColor: pass ? "#F0FDF4" : "#FEF2F2", borderWidth: 2 },
        disabled && { opacity: 0.45 },
      ]}
    >
      <View style={[s.resultIcon, selected && { backgroundColor: color }]}>
        <FontAwesome5 name={pass ? "check" : "times"} size={13} color={selected ? "#fff" : color} />
      </View>
      <Text style={[s.resultTitle, { color }]}>{t(pass ? "puspakom.bus.passed" : "puspakom.bus.failed")}</Text>
      <Text style={s.resultHint}>{t(pass ? "puspakom.bus.passedHint" : "puspakom.bus.failedHint")}</Text>
    </Pressable>
  );
}

function SlipPicker({ slips, onAdd, onRemove }: { slips: LocalMedia[]; onAdd: () => void; onRemove: (i: number) => void }) {
  const { t } = useI18n();
  return (
    <View style={s.slipRow}>
      {slips.map((m, i) => (
        <View key={m.localUri} style={s.slipThumb}>
          <Image source={{ uri: m.localUri }} style={s.slipImg} />
          <Pressable style={s.slipRemove} onPress={() => onRemove(i)} hitSlop={8}>
            <FontAwesome5 name="times" size={9} color="#fff" />
          </Pressable>
        </View>
      ))}
      <Pressable style={s.slipAdd} onPress={onAdd}>
        <FontAwesome5 name="camera" size={16} color={FM} />
        <Text style={[s.slipAddText, { color: FM }]}>{t("puspakom.bus.addPhoto")}</Text>
      </Pressable>
    </View>
  );
}

function PhotoRow({ urls }: { urls: (string | null)[] }) {
  const shown = urls.filter((u): u is string => !!u);
  if (!shown.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 8 }}>
      {shown.map((u) => (
        <Image key={u} source={{ uri: u }} style={s.photo} />
      ))}
    </ScrollView>
  );
}

/** "Stop 4 · Left side · pre-inspection: 3.6 mm · Check soon" */
function checkMeta(def: PspCheckDef, a: PspAnswer | undefined, data: PspDetail, t: (k: string, v?: any) => string) {
  const stop = data.defs?.stops.find((st) => st.stop_no === def.stop_no);
  const parts = [t("puspakom.failedSheet.stopShort", { no: def.stop_no }), stop?.stop_name].filter(Boolean);
  const summary = answerSummary(def, a, t);
  return `${parts.join(" · ")}${summary ? ` · ${summary}` : ""}`;
}

export function answerSummary(def: PspCheckDef, a: PspAnswer | undefined, t: (k: string, v?: any) => string): string {
  if (!a) return "";
  const tag = a.tag && a.tag !== "OK" ? ` · ${t(`puspakom.tags.${a.tag}`)}` : "";
  switch (def.answer_type) {
    case "OK_NG":
      if (a.answer === "NG") return `NG${a.ng_reason ? ` · ${t(`puspakom.ngReason.${a.ng_reason}`)}` : ""}`;
      return a.answer ?? "";
    case "TYRE":
      return `${a.tread_mm ?? "—"} mm · ${a.pressure_psi ?? "—"} psi${tag}`;
    case "BRAKE":
      return `${a.pad_mm ?? "—"} mm${tag}`;
    case "BODY":
      return a.answer === "DAMAGE" ? `${t("puspakom.tags.DAMAGE")} (${a.damages.length})` : t("puspakom.checklist.noDamage");
  }
}

// ---------------------------------------------------------------------------

function FailedChecksSheet({
  visible,
  checks,
  stops,
  answers,
  picked,
  onClose,
  onAdd,
}: {
  visible: boolean;
  checks: PspCheckDef[];
  stops: { stop_no: number; stop_name: string }[];
  answers: PspAnswer[];
  picked: string[];
  onClose: () => void;
  onAdd: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>(picked);
  const [openStops, setOpenStops] = useState<number[]>([]);
  const ansById = useMemo(() => new Map(answers.map((a) => [a.check_id, a])), [answers]);

  // Re-seed the ticks each time the sheet opens.
  const [lastVisible, setLastVisible] = useState(false);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) {
      setSel(picked);
      setQ("");
    }
  }

  const needle = q.trim().toLowerCase();
  const match = (c: PspCheckDef) =>
    !needle ||
    c.label.toLowerCase().includes(needle) ||
    c.check_id.toLowerCase().includes(needle) ||
    (stops.find((s0) => s0.stop_no === c.stop_no)?.stop_name ?? "").toLowerCase().includes(needle);

  const flagged = checks.filter((c) => ATTENTION_TAGS.includes(ansById.get(c.check_id)?.tag as any) && match(c));
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);

  const row = (c: PspCheckDef) => {
    const a = ansById.get(c.check_id);
    const on = sel.includes(c.check_id);
    const tagTone = a?.tag ? TAG_TONE[a.tag] : null;
    const stop = stops.find((s0) => s0.stop_no === c.stop_no);
    return (
      <Pressable key={c.check_id} style={s.pickRow} onPress={() => toggle(c.check_id)}>
        <View style={[s.check, on && { backgroundColor: "#B91C1C", borderColor: "#B91C1C" }]}>
          {on && <FontAwesome5 name="check" size={10} color="#fff" />}
        </View>
        <Text style={s.pickId}>{c.check_id}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.pickLabel}>{c.label}</Text>
          <Text style={s.pickMeta} numberOfLines={1}>
            {a
              ? ATTENTION_TAGS.includes(a.tag as any)
                ? `${t("puspakom.failedSheet.stopShort", { no: c.stop_no })} · ${stop?.stop_name ?? ""} · ${answerSummary(c, a, t)}`
                : t("puspakom.failedSheet.okInPre")
              : t("puspakom.failedSheet.notAnswered")}
          </Text>
        </View>
        {tagTone && a?.tag !== "OK" && <Pill small label={t(`puspakom.tags.${a!.tag}`)} tone={tagTone} />}
      </Pressable>
    );
  };

  return (
    <Sheet
      visible={visible}
      tall
      title={t("puspakom.failedSheet.title")}
      subtitle={t("puspakom.failedSheet.subtitle", { count: checks.length })}
      onClose={onClose}
      footer={
        <Pressable
          disabled={sel.length === 0}
          style={[s.primary, { flex: 1, backgroundColor: "#DC2626" }, sel.length === 0 && s.primaryDisabled]}
          onPress={() => onAdd(sel)}
        >
          <Text style={[s.primaryText, sel.length === 0 && { color: "#6B7280" }]}>
            {sel.length === 1 ? t("puspakom.failedSheet.addOne") : t("puspakom.failedSheet.add", { count: sel.length })}
          </Text>
        </Pressable>
      }
    >
      <View style={s.searchBox}>
        <FontAwesome5 name="search" size={12} color="#9CA3AF" />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t("puspakom.failedSheet.search")}
          placeholderTextColor="#9CA3AF"
          style={s.searchInput}
          autoCorrect={false}
        />
      </View>
      {flagged.length > 0 && (
        <>
          <Text style={s.pickSection}>{t("puspakom.failedSheet.flagged")}</Text>
          {flagged.map(row)}
        </>
      )}
      <Text style={s.pickSection}>{t("puspakom.failedSheet.byStop")}</Text>
      {stops.map((st) => {
        const list = checks.filter((c) => c.stop_no === st.stop_no && match(c));
        if (!list.length) return null;
        const open = !!needle || openStops.includes(st.stop_no);
        return (
          <View key={st.stop_no}>
            <Pressable
              style={s.stopHead}
              onPress={() => setOpenStops(open ? openStops.filter((x) => x !== st.stop_no) : [...openStops, st.stop_no])}
            >
              <Text style={s.stopNo}>{st.stop_no}</Text>
              <Text style={s.stopName}>{st.stop_name}</Text>
              <Text style={s.stopCount}>{t("puspakom.failedSheet.nChecks", { count: list.length })}</Text>
              <FontAwesome5 name={open ? "chevron-up" : "chevron-down"} size={11} color="#6B7280" />
            </Pressable>
            {open && list.map(row)}
          </View>
        );
      })}
      <View style={{ height: 16 }} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function Chronology({ events }: { events: PspEvent[] }) {
  const { t } = useI18n();
  if (!events.length) return null;
  return (
    <Section icon="history" title={t("puspakom.bus.chronology")}>
      {events.map((e, i) => (
        <View key={e.event_id} style={s.evRow}>
          <View style={s.evRail}>
            <View style={[s.evDot, { backgroundColor: eventColor(e.type) }]} />
            {i < events.length - 1 && <View style={s.evLine} />}
          </View>
          <View style={{ flex: 1, paddingBottom: 14 }}>
            <Text style={s.evTitle}>{t(`puspakom.events.${e.type}`)}</Text>
            <Text style={s.evMeta}>
              {[e.actor, fmtDateTime(e.at)].filter(Boolean).join(" · ")}
            </Text>
            {!!eventDetail(e, t) && <Text style={s.evDetail}>{eventDetail(e, t)}</Text>}
          </View>
        </View>
      ))}
    </Section>
  );
}

function eventColor(type: PspEvent["type"]) {
  if (type === "RESULT_FAILED") return "#DC2626";
  if (type === "RESULT_PASSED" || type === "PRECHECK_SUBMITTED" || type === "RECHECK_SUBMITTED") return "#16A34A";
  return "#2563EB";
}

export function eventDetail(e: PspEvent, t: (k: string, v?: any) => string): string {
  const d = e.detail ?? {};
  switch (e.type) {
    case "REGISTERED":
      return `${t(`puspakom.type.${d.inspection_type}`)} · ${fmtDateTime(d.scheduled_at)}`;
    case "BOOKING_CHANGED":
      return d.scheduled_at ? t("puspakom.events.movedDetail", { to: fmtDateTime(d.scheduled_at.to) }) : "";
    case "PRECHECK_SUBMITTED":
      return t("puspakom.events.checksDetail", {
        checks: d.checks,
        photos: d.photos,
        attention: (d.needs_attention ?? []).length,
      });
    case "RESULT_FAILED":
      return (d.failed ?? []).map((f: any) => `${f.check_id} ${f.label}: ${f.puspakom_found}`).join("\n");
    case "REINSPECTION_BOOKED":
      return `${t("puspakom.type.REINSPECTION")} · ${fmtDateTime(d.scheduled_at)}`;
    case "RECHECK_SUBMITTED":
      return (d.fixed ?? []).map((f: any) => `${f.check_id} ${f.label}`).join(", ");
    case "RESULT_PASSED":
      return d.next_due ? t("puspakom.events.nextDueDetail", { date: fmtDate(d.next_due) }) : "";
  }
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, paddingBottom: 48, width: "100%", maxWidth: 640, alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { color: "#B91C1C", textAlign: "center" },
  plate: { fontSize: 24, fontWeight: "800", color: "#111827", marginTop: 6 },
  ev: { fontSize: 15, fontWeight: "600", color: "#6B7280" },
  model: { fontSize: 13, fontWeight: "700", color: "#374151", marginTop: 2 },
  muted: { fontSize: 13, color: "#6B7280", paddingVertical: 8 },
  note: { fontSize: 12, color: "#6B7280", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, marginTop: 10 },
  hint: { fontSize: 12, color: "#6B7280", marginBottom: 8 },
  link: { fontSize: 14, fontWeight: "700" },
  primary: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 14 },
  primaryDisabled: { backgroundColor: "#E5E7EB" },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  secondaryBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    marginTop: 10,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "800" },
  failedPanel: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 16, padding: 14, marginBottom: 12 },
  failedTitle: { fontSize: 15, fontWeight: "800", color: "#991B1B", marginBottom: 6 },
  failedItem: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#FECACA" },
  failedItemTitle: { fontSize: 13, fontWeight: "800", color: "#7F1D1D" },
  failedFound: { fontSize: 13, color: "#7F1D1D", marginTop: 2 },
  fixItem: { paddingTop: 10, marginTop: 6, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  fixTitle: { fontSize: 13, fontWeight: "800", color: "#111827" },
  fixText: { fontSize: 13, color: "#374151", marginTop: 2 },
  photo: { width: 96, height: 72, borderRadius: 8, backgroundColor: "#E5E7EB" },
  resultRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  resultCard: { flex: 1, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 14, padding: 12, backgroundColor: "#fff" },
  resultIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  resultTitle: { fontSize: 15, fontWeight: "800" },
  resultHint: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  nextDue: { backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 12, padding: 12, marginTop: 12 },
  nextDueLabel: { fontSize: 10, fontWeight: "800", color: "#15803D", letterSpacing: 0.4, textTransform: "uppercase" },
  nextDueValue: { fontSize: 18, fontWeight: "800", color: "#14532D", marginTop: 2 },
  nextDueHint: { fontSize: 12, color: "#15803D", marginTop: 2 },
  failedCard: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 12, padding: 12, marginBottom: 8 },
  failedCardHead: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  checkIdBadge: { backgroundColor: "#DC2626", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  checkIdText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  failedCardTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  failedCardMeta: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  foundLabel: { fontSize: 11, fontWeight: "800", color: "#991B1B", marginTop: 8, marginBottom: 4 },
  foundInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
    color: "#111827",
  },
  addFailed: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#FCA5A5",
    borderRadius: 12,
    paddingVertical: 12,
  },
  addFailedText: { color: "#B91C1C", fontWeight: "800", fontSize: 14 },
  slipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slipThumb: { width: 76, height: 76, borderRadius: 10, overflow: "hidden" },
  slipImg: { width: "100%", height: "100%" },
  slipRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  slipAdd: {
    width: 76,
    height: 76,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#93C5FD",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#EFF6FF",
  },
  slipAddText: { fontSize: 11, fontWeight: "700" },
  reBox: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 12, padding: 12, marginTop: 14 },
  reHead: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 8 },
  reTitle: { fontSize: 14, fontWeight: "800", color: "#991B1B" },
  reHint: { fontSize: 12, color: "#991B1B", marginTop: 8 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F3F4F6", borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: "#111827" },
  pickSection: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 14, marginBottom: 4 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  check: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  pickId: { fontSize: 12, fontWeight: "800", color: "#6B7280", width: 30 },
  pickLabel: { fontSize: 14, fontWeight: "700", color: "#111827" },
  pickMeta: { fontSize: 12, color: "#6B7280" },
  stopHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  stopNo: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#F3F4F6", textAlign: "center", lineHeight: 22, fontSize: 12, fontWeight: "800", color: "#374151", overflow: "hidden" },
  stopName: { flex: 1, fontSize: 14, fontWeight: "700", color: "#111827" },
  stopCount: { fontSize: 12, color: "#6B7280" },
  evRow: { flexDirection: "row", gap: 10 },
  evRail: { width: 14, alignItems: "center" },
  evDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  evLine: { flex: 1, width: 2, backgroundColor: "#E5E7EB", marginTop: 2 },
  evTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  evMeta: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  evDetail: { fontSize: 12, color: "#374151", marginTop: 3 },
});
