import { createLucideIcon } from "lucide-react-native";

// A simplified line-art rendition of a 3-gauge instrument cluster
// (tachometer + speedometer flanked by two smaller gauges), matching the
// stroke style of the app's other lucide icons — stands in for the
// "instrument cluster / dashboard" photo requirement on the report form
// and the technician's after-photo slots.
const InstrumentClusterIcon = createLucideIcon("InstrumentCluster", [
  ["circle", { cx: "6", cy: "16", r: "4", key: "ic-left" }],
  ["circle", { cx: "18", cy: "16", r: "4", key: "ic-right" }],
  ["circle", { cx: "12", cy: "10.5", r: "6.5", key: "ic-center" }],
  ["path", { d: "M12 10.5 L15 7", key: "ic-needle" }],
]);

export default InstrumentClusterIcon;
