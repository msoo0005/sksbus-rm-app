import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import ProjectChip from "@/components/ProjectChip";
import SegmentedTabs from "@/components/SegmentedTabs";
import TyreAttentionStrip from "@/components/tyres/TyreAttentionStrip";
import BusesPanel from "@/components/tyres/panels/BusesPanel";
import SummaryPanel from "@/components/tyres/panels/SummaryPanel";
import TyresPanel, { type TyreFilter } from "@/components/tyres/panels/TyresPanel";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useTyreSectionData, type BusFilter } from "@/hooks/useTyreSectionData";
import { useI18n } from "@/i18n/i18n-ctx";

// Tyre management: one screen, three views of the same fleet.
//
// This used to be a menu — three cards that fetched four endpoints purely to
// print counts on themselves, then threw the payloads away and pushed you to a
// list that refetched three of them. It cost a tap and a round trip and showed
// no work. Everything it linked to now lives here as a panel, which takes a
// level out of every task in the section and makes moving between buses and
// tyres one tap instead of back-then-tap.
//
// WHY THE PANELS STAY MOUNTED. Switching tab hides the old panel with
// display:'none' rather than unmounting it, so coming back to Buses — including
// from a bus three screens deep — restores the filter, the search text and the
// scroll offset exactly. Unmounting would reset all three, which is the
// disorientation tabs are supposed to fix. A panel is mounted lazily on first
// visit, so nothing is paid for a tab that is never opened.
//
// The consequence, and it is a sharp one: a hidden panel is still inside a
// FOCUSED screen. Anything using useFocusEffect inside a panel would therefore
// fire for tabs nobody is looking at. So no panel fetches on focus — shared data
// is loaded once by useTyreSectionData here, and SummaryPanel (the only
// panel-specific request) gates its own load on `active`.

type TabKey = "buses" | "tyres" | "summary";

export default function TyreSectionScreen() {
  const { t } = useI18n();
  const projectId = useProjectFilter();
  const data = useTyreSectionData(projectId);

  const [tab, setTab] = useState<TabKey>("buses");
  // Mounting is one-way: a panel visited once stays alive for the session.
  const [mounted, setMounted] = useState<Set<TabKey>>(() => new Set<TabKey>(["buses"]));

  // Filters live here, not in the panels, so the attention strip can select one
  // and switch tab in the same gesture.
  const [busFilter, setBusFilter] = useState<BusFilter>("all");
  const [tyreFilter, setTyreFilter] = useState<TyreFilter>("all");

  const show = useCallback((next: TabKey) => {
    setTab(next);
    setMounted((m) => (m.has(next) ? m : new Set(m).add(next)));
  }, []);

  const panelStyle = (key: TabKey) => [
    styles.panel,
    { display: (tab === key ? "flex" : "none") as "flex" | "none" },
  ];

  return (
    <View style={styles.page}>
      <View style={styles.chrome}>
        {/* Nothing else in this section says which project's fleet is on
            screen, and every figure below is filtered by it. Same reasoning and
            placement as the inventory screen, which has the same problem. */}
        <View style={styles.chipWrap}>
          <ProjectChip />
        </View>

        <TyreAttentionStrip
          overdueBuses={data.counts.overdue}
          pastLimitTyres={data.counts.pastLimit}
          // Each item goes to the tab whose noun it counts. "Overdue" counts
          // buses; "past limit" counts tyres — sending both to the bus list
          // would make the second one contradict the rows it landed on.
          onOverdue={() => {
            setBusFilter("overdue");
            show("buses");
          }}
          onPastLimit={() => {
            setTyreFilter("pastLimit");
            show("tyres");
          }}
        />

        <SegmentedTabs<TabKey>
          value={tab}
          onChange={show}
          tabs={[
            { key: "buses", label: `${t("tyres.section.tabBuses")} (${data.counts.buses})`, icon: "bus" },
            { key: "tyres", label: `${t("tyres.section.tabTyres")} (${data.counts.tyres})`, icon: "dot-circle" },
            { key: "summary", label: t("tyres.section.tabSummary"), icon: "chart-bar" },
          ]}
        />
      </View>

      <View style={styles.host}>
        {mounted.has("buses") && (
          <View style={panelStyle("buses")}>
            <BusesPanel data={data} filter={busFilter} onFilterChange={setBusFilter} />
          </View>
        )}
        {mounted.has("tyres") && (
          <View style={panelStyle("tyres")}>
            <TyresPanel data={data} filter={tyreFilter} onFilterChange={setTyreFilter} />
          </View>
        )}
        {mounted.has("summary") && (
          <View style={panelStyle("summary")}>
            <SummaryPanel active={tab === "summary"} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  // Fixed: the chrome must not scroll away, or the tabs stop being orientation.
  chrome: { backgroundColor: "#F9FAFB" },
  chipWrap: { paddingHorizontal: 16, paddingTop: 12 },
  // Defines the box each panel fills, so a panel's own FlatList is the single
  // scroll container and never nests inside another one.
  host: { flex: 1 },
  panel: { ...StyleSheet.absoluteFillObject },
});
