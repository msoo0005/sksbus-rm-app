import { FontAwesome5 } from "@expo/vector-icons";
import { useI18n } from "../i18n/i18n-ctx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { formatElapsed, useElapsedMs } from "../utils/elapsedTime";
import ImageViewerOverlay from "./ImageViewerOverlay";
import PersonChip from "./PersonChip";

export type TimelineEvent = {
  id: string;
  icon: string;
  color: string;
  colorLight: string;
  title: string;
  subtitle?: string | null;
  // Who performed this event, rendered as its own "by NAME" line — kept
  // separate from `subtitle` since subtitle is also used for unrelated
  // event details (e.g. a task's description, the odometer reading).
  by?: string | null;
  // The account username behind `by` (shown as @username when it differs).
  username?: string | null;
  // Identity-verification selfie captured alongside `by`, for the sign-off
  // stages (report submitted / approved / accepted / completed). Shown as a
  // tappable photo next to the name.
  selfieUrl?: string | null;
  at: string;
};

export type PendingTimelineStage = {
  label: string;
  subtitle: string;
  icon: string;
  color: string;
  colorLight: string;
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// A slowly blinking dot marking whichever stage hasn't happened yet — draws
// the eye to what the job is currently waiting on, without implying a
// timestamp the way the solid completed-event icons do.
function PendingIconBox({ color, colorLight, icon }: { color: string; colorLight: string; icon: string }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View style={[s.iconBox, s.iconBoxPending, { backgroundColor: colorLight, borderColor: color, opacity }]}>
      <FontAwesome5 name={icon as any} size={11} color={color} />
    </Animated.View>
  );
}

// Live "how long has this been pending" readout — ticks from the moment the
// last completed step happened, since that's when the current stage began.
function PendingTimer({ since, color }: { since: string | null; color: string }) {
  const elapsedMs = useElapsedMs(since);
  if (elapsedMs == null) return null;

  return <Text style={[s.pendingTimer, { color }]}>{formatElapsed(elapsedMs)}</Text>;
}

export default function JobTimeline({
  events,
  pendingStage,
}: {
  events: TimelineEvent[];
  pendingStage?: PendingTimelineStage | null;
}) {
  const { t } = useI18n();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      events
        .filter((e) => !!e.at)
        .slice()
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [events],
  );

  if (sorted.length === 0 && !pendingStage) {
    return <Text style={s.mutedText}>{t("jobTimeline.noActivity")}</Text>;
  }

  // The pending stage begins right after whatever the last completed step
  // was — falls back to null (renders no timer) if there's no history yet.
  const pendingSince = sorted.length ? sorted[sorted.length - 1].at : null;

  return (
    <View>
      {sorted.map((e, idx) => {
        const isLastRow = idx === sorted.length - 1 && !pendingStage;
        return (
          <View key={e.id} style={s.row}>
            <View style={s.iconCol}>
              <View style={[s.iconBox, { backgroundColor: e.colorLight }]}>
                <FontAwesome5 name={e.icon as any} size={11} color={e.color} />
              </View>
              {!isLastRow && <View style={s.line} />}
            </View>
            <View style={[s.body, isLastRow && { paddingBottom: 0 }]}>
              <Text style={s.title}>{e.title}</Text>
              {!!e.subtitle && <Text style={s.subtitle}>{e.subtitle}</Text>}
              {(!!e.by || !!e.username || !!e.selfieUrl) && (
                <View style={s.byRow}>
                  <PersonChip
                    name={e.by}
                    username={e.username}
                    selfieUrl={e.selfieUrl}
                    size={36}
                    onPressPhoto={setPreviewUrl}
                  />
                </View>
              )}
              <Text style={s.time}>{formatDateTime(e.at)}</Text>
            </View>
          </View>
        );
      })}

      {pendingStage && (
        <View style={s.row}>
          <View style={s.iconCol}>
            <PendingIconBox color={pendingStage.color} colorLight={pendingStage.colorLight} icon={pendingStage.icon} />
          </View>
          <View style={[s.body, { paddingBottom: 0 }]}>
            <Text style={[s.title, { color: pendingStage.color }]}>{pendingStage.label}</Text>
            <Text style={s.pendingSubtitle}>{pendingStage.subtitle}</Text>
            <PendingTimer since={pendingSince} color={pendingStage.color} />
          </View>
        </View>
      )}

      <ImageViewerOverlay
        visible={!!previewUrl}
        imageUrls={previewUrl ? [{ url: previewUrl }] : []}
        onClose={() => setPreviewUrl(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  mutedText: { fontSize: 14, color: "#9CA3AF", fontWeight: "500" },
  row: { flexDirection: "row" },
  iconCol: { alignItems: "center", width: 32 },
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBoxPending: {
    borderWidth: 1.5,
    borderStyle: "dashed",
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: "#E5E7EB",
    marginVertical: 4,
  },
  body: { flex: 1, paddingBottom: 18, paddingLeft: 10 },
  title: { fontSize: 14, fontWeight: "700", color: "#111827" },
  subtitle: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
    marginTop: 2,
  },
  byRow: { marginTop: 6 },
  time: { fontSize: 12, color: "#9CA3AF", fontWeight: "600", marginTop: 3 },
  pendingSubtitle: {
    fontSize: 12,
    color: "#9CA3AF",
    fontWeight: "600",
    fontStyle: "italic",
    marginTop: 2,
  },
  pendingTimer: {
    fontSize: 13,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    marginTop: 4,
  },
});
