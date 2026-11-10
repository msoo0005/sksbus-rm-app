import React, { useMemo, useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { parseReadings, type AxleSide, type UnevenWearType } from "../utils/tyreWear";
import TyreWearPill from "./tyres/TyreWearPill";

// The tread drawn as a cross-section through the tyre: N grooves cut into a slab
// of rubber, which leaves N+1 ribs. A 4-groove tyre is five ribs with four
// grooves between them, so no reading is drawn as a rib and no rib is drawn as a
// reading.
//
// THE READING IS THE BLANK SPACE. Each groove's reading is the height of the
// white gap beside it, not the height of any black block. The ribs are what
// move, and each crown SLOPES: a rib's left corner sits at the left groove's
// reading and its right corner at the right groove's, so every groove is walled
// on both sides at exactly its own depth and the crown line steps and slopes
// across the tread the way a worn tyre does. The groove floors all sit on one baseline — that is the belt
// the tread is moulded onto, and it does not move.
//
// So: FLOORS IN LINE, CROWNS STEP. Reading the silhouette left to right reads the
// wear pattern directly, and the dashed line marks the deepest groove, so any
// crown falling short of it is rubber that has worn away faster than its
// neighbours. That is the same comparison classifyUnevenWear makes.
//
// Two earlier versions got this wrong in opposite directions and are worth naming
// so neither comes back. The first gave each READING its own rib whose height was
// the depth — right that the measurement is a height, wrong that a 4-groove tyre
// has four ribs. The second kept all five ribs at full height and cut a notch down
// from a level crown line — right about the rib count, wrong about what moves:
// nothing black shifted, so the silhouette carried no wear at all.
//
// SHAPED LIKE A TYRE. Each rib is a straight-sided column under a rounded or
// sloped crown, sitting in a slot a little wider than itself so the grooves read
// as cut rather than as gaps. The two outer ribs — the shoulders — round hard on
// their outer corners, where the tread would turn down into the sidewall.
//
// The sides are VERTICAL, deliberately. Ribs used to flare towards the base,
// which left each rib's shoulders standing out past the corners of its own
// crown; the wedge, the cap and the body now share one pair of edges. The only
// diagonal left in the drawing is the sloped crown itself.
//
// Two faults from earlier versions are worth naming so neither comes back. One
// drew black rubber under each groove as a second trapezoid, so two
// independently rendered diagonals had to meet exactly; at fractional
// coordinates they didn't, and black wedges showed in the grooves. In this
// geometry a groove is EMPTY — nothing whatsoever is drawn for it. The other
// floored the rib crown at 2px, which on narrow layouts made a rib wider than
// its slot and pushed it into the groove beside it; Rib clamps the INSET to the
// slot instead, so a rib can never outgrow the space it was given.
//
// INTEGER EDGES. Segment boundaries are the ROUNDED cumulative offsets and each
// width is the difference between two of them, so a rib always lands on an exact
// integer edge and never bleeds into the gap beside it.
//
// Deliberately built from plain Views rather than SVG: react-native-svg is only
// a transitive dep here, and adding it means a native rebuild.

type BaseProps = {
  // Accepts live form strings and persisted numbers alike, so the same drawing
  // serves the capture form and every read-only screen.
  readings: (string | number | null | undefined)[];
  // Tread depth of a new tyre — what the full slab height represents. 20mm
  // covers the deepest the fleet carries (GT 867 / LM 666 at 18-20mm).
  maxMm?: number;
  // Mirrors the Lambda's TYRE_LOW_TREAD_THRESHOLD_MM.
  criticalMm?: number;
  warnMm?: number;
  // The STORED finding, to render. Required whenever showUnevenWear is on, and
  // never re-derived from `readings` here.
  //
  // This used to fall back to classifying `readings` itself when omitted. That
  // was safe while the label named no direction, but toe-in and toe-out depend
  // on the readings being ordered outer-to-inner — a convention only guaranteed
  // for inspections captured after migration 015. Re-deriving would invent a
  // direction for historic rows whose groove order nobody recorded. The union
  // below makes the omission impossible rather than merely discouraged.
  unevenWear: UnevenWearType | null;
  /** The wheel's side, so a re-derived classification gets toe the right way round. */
  axleSide?: AxleSide | null;
  compact?: boolean;
};

/**
 * Either draw the tread and its stored wear finding, or draw the tread alone.
 *
 * Split into a union so "show the finding" and "supply the finding" cannot come
 * apart: the capture form draws the slab live as the technician types but has no
 * stored finding to show yet, and every read-only screen has one.
 */
type Props =
  | (BaseProps & { showUnevenWear?: true })
  | (Omit<BaseProps, "unevenWear"> & { showUnevenWear: false; unevenWear?: never });

const TREAD_HEIGHT = 96;
const COMPACT_TREAD_HEIGHT = 58;
// How wide each groove is cut.
const GROOVE_GAP = 12;
const COMPACT_GROOVE_GAP = 8;
// Rounded crown on each rib, so it reads as moulded rubber, not a bar.
const CROWN = 4;
// The two outermost ribs are the tyre's SHOULDERS, where the tread turns down
// into the sidewall. Rounding their outer corners hard is most of what makes the
// drawing read as a cross-section rather than a bar chart.
const SHOULDER = 14;
const COMPACT_SHOULDER = 9;
// The margin each side of a rib inside its slot, which is what makes a groove
// read wider than the bare GROOVE_GAP. Scaled down on narrow ribs — see Rib,
// where letting this exceed the rib's own slot was what drove an earlier version
// into the grooves beside it.
const TAPER = 7;
const COMPACT_TAPER = 4;
// How far a reading's label may spill past its groove on each side. A groove
// is narrower than the text that labels it.
const LABEL_OVERHANG = 14;
const CASING_HEIGHT = 10;
const RUBBER = "#111827";
const UNMEASURED = "#D1D5DB";
// An unmeasured groove is drawn mid-depth and greyed: deep enough to show that
// a groove exists there, never deep or shallow enough to be mistaken for a
// reading. "Not measured" must not look like "worn away".
const UNMEASURED_FRACTION = 0.45;

function parseOne(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * One segment of the slab: a full-height rib, or the rubber left under one
 * groove. Same component either way — the only difference is how tall it is,
 * and the height of a groove's rubber is what encodes its depth.
 */
/**
 * One rib of tread rubber: a straight-sided column with a SLOPED crown.
 *
 * A rib stands between two grooves, and each of its two top corners is the wall
 * of the groove on that side — so its left corner sits at the left groove's
 * reading and its right corner at the right groove's. Every groove therefore
 * ends up bounded by walls at exactly its own depth, with no patching needed.
 *
 * An earlier version gave each rib ONE flat height, taken as the deeper of its
 * two grooves. That over-fills any groove shallower than its neighbour, so a
 * separate black bar had to be drawn across the groove to bring the gap back
 * down to its reading — which floated in the middle of the drawing and read as a
 * glitch. A sloped crown makes that bar unnecessary rather than tidier.
 *
 * Drawn as a straight column with a right-triangle wedge on top, both the same
 * width so their edges line up. When the two corners are level (even wear, and
 * always on the two shoulders) there is no wedge and the crown takes its rounded
 * cap instead.
 */
function Rib({
  left,
  width,
  heightLeft,
  heightRight,
  taper,
  colour,
  radiusLeft,
  radiusRight,
}: {
  left: number;
  width: number;
  heightLeft: number;
  heightRight: number;
  taper: number;
  colour: string;
  radiusLeft: number;
  radiusRight: number;
}) {
  const low = Math.min(heightLeft, heightRight);
  const rise = Math.abs(heightRight - heightLeft);
  if (low <= 0 && rise <= 0) return null;
  if (width <= 0) return null;

  const inset = ribInset(width, taper);
  const crown = width - inset * 2;
  const capRadiusL = Math.min(radiusLeft, crown / 2);
  const capRadiusR = Math.min(radiusRight, crown / 2);
  // Only a level crown gets a rounded cap — rounding a sloped one would blunt
  // the very corner that forms the groove wall.
  const cap = rise > 0 ? 0 : Math.min(Math.round(Math.max(capRadiusL, capRadiusR, CROWN)), low);
  const body = Math.max(0, low - cap);

  return (
    <View style={{ position: "absolute", bottom: 0, left, width, alignItems: "center" }}>
      {rise > 0 && (
        // A CSS border triangle: a box with no content, one coloured bottom
        // border and one transparent side border. The apex lands on the side
        // whose border is transparent, which is the side that rides higher.
        <View
          style={{
            width: 0,
            height: 0,
            borderBottomWidth: rise,
            borderBottomColor: colour,
            ...(heightRight > heightLeft
              ? { borderLeftWidth: crown, borderLeftColor: "transparent" }
              : { borderRightWidth: crown, borderRightColor: "transparent" }),
          }}
        />
      )}
      {cap > 0 && (
        <View
          style={{
            width: crown,
            height: cap,
            backgroundColor: colour,
            borderTopLeftRadius: capRadiusL,
            borderTopRightRadius: capRadiusR,
          }}
        />
      )}
      {/* A straight column, exactly as wide as the cap and the wedge above it,
          so all three pieces share one pair of vertical edges. This used to
          flare out to the full slot width — a border-trapezoid that widened
          towards the base — which left the rib's shoulders sticking out past
          the corners of its own crown. */}
      <View style={{ width: crown, height: body, backgroundColor: colour }} />
    </View>
  );
}

/**
 * The empty margin on each side of a rib inside its slot — which is also half
 * of how much wider a groove reads than its nominal gap.
 *
 * This used to be a taper: the rib filled its whole slot at the base and leaned
 * in towards the crown. Now the rib is a straight column of `width - 2 * inset`,
 * so the same number sets the groove's width rather than its angle.
 *
 * Floored to a whole pixel: a fractional crown puts the centred cap on a half
 * pixel, which shows as a white edge down one side of the rib. Flooring (not
 * rounding) also keeps the result inside the (width - 2) / 2 bound, so the crown
 * can never fall below 2px.
 */
function ribInset(width: number, taper: number) {
  return Math.max(0, Math.floor(Math.min(taper, width * 0.3, (width - 2) / 2)));
}

export default function TyreTreadProfile({
  readings,
  maxMm = 20,
  criticalMm = 5,
  warnMm = 8,
  unevenWear,
  axleSide,
  showUnevenWear = true,
  compact = false,
}: Props) {
  const treadHeight = compact ? COMPACT_TREAD_HEIGHT : TREAD_HEIGHT;
  const gap = compact ? COMPACT_GROOVE_GAP : GROOVE_GAP;
  const taper = compact ? COMPACT_TAPER : TAPER;
  const shoulder = compact ? COMPACT_SHOULDER : SHOULDER;

  // Every segment is placed against measured pixel positions, so the drawing
  // waits for a real width.
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - width) > 0.5) setWidth(w);
  };

  const { grooves, ribs, referenceTop, anyMeasured } = useMemo(() => {
    const parsed = readings.map(parseOne);
    const measured = parseReadings(readings);
    const deepest = measured.length ? Math.max(...measured) : null;
    // ROUNDED, and not as a nicety. A rib is drawn as a solid rounded cap
    // stacked on a border-trapezoid body, so its height is split across two
    // Views; at a fractional height the two land on opposite sides of a half
    // pixel and the join renders as a white hairline straight across the rib.
    // Integers make cap + body meet exactly.
    const heightFor = (mm: number) => Math.round(Math.min(mm / maxMm, 1) * treadHeight);

    // Each of a rib's two top corners IS the wall of the groove on that side,
    // so it sits at that groove's reading. Every groove is then bounded, on both
    // sides, by walls at exactly its own depth — which is what the drawing
    // claims, and it now holds by construction rather than by patching.
    //
    // The outer two ribs are shoulders with a groove on one side only, so both
    // their corners take that one reading and their crowns come out level.
    const n = parsed.length;
    const unmeasured = Math.round(treadHeight * UNMEASURED_FRACTION);
    const cornerAt = (i: number) => parsed[i];

    const ribs = Array.from({ length: n + 1 }, (_, j) => {
      const leftGroove = cornerAt(j === 0 ? 0 : j - 1);
      const rightGroove = cornerAt(j === n ? n - 1 : j);
      const measured = leftGroove != null || rightGroove != null;
      // A groove with no reading yet leaves its wall at a neutral stub rather
      // than at zero, so a half-filled form still draws as a tyre.
      const hl = leftGroove != null ? heightFor(leftGroove) : unmeasured;
      const hr = rightGroove != null ? heightFor(rightGroove) : unmeasured;
      return { heightLeft: hl, heightRight: hr, measured };
    });

    return {
      grooves: parsed.map((mm) => ({
        mm,
        labelColour:
          mm == null
            ? UNMEASURED
            : mm < criticalMm
              ? "#DC2626"
              : mm < warnMm
                ? "#B45309"
                : "#16A34A",
      })),
      ribs,
      // The crown line of the deepest groove — where every crown would sit if
      // the tyre were wearing evenly across the tread.
      referenceTop: deepest == null ? null : treadHeight - heightFor(deepest),
      anyMeasured: measured.length > 0,
    };
  }, [readings, maxMm, criticalMm, warnMm, treadHeight]);

  const rubber = anyMeasured ? RUBBER : UNMEASURED;
  const n = grooves.length;

  // N grooves and N+1 ribs tile the full width: each groove takes `gap`, and the
  // ribs share what is left.
  //
  // The slab is laid out as one alternating run — rib, groove, rib, … , rib —
  // whose boundaries are computed as exact fractions and then ROUNDED. Each
  // segment's width is the difference between its two rounded edges, so every
  // neighbour shares an integer edge: the widths absorb the rounding instead of
  // leaving hairline gaps between two pieces of the same black slab.
  const segments = useMemo(() => {
    if (width <= 0 || n < 0) return [];
    const ribWidth = (width - n * gap) / (n + 1);
    if (ribWidth <= 0) return [];

    const out: { left: number; width: number; groove: number | null }[] = [];
    let edge = 0;
    let prev = 0;
    for (let k = 0; k < n * 2 + 1; k++) {
      const isGroove = k % 2 === 1;
      edge += isGroove ? gap : ribWidth;
      const right = Math.round(edge);
      out.push({ left: prev, width: right - prev, groove: isGroove ? (k - 1) / 2 : null });
      prev = right;
    }
    return out;
  }, [width, n, gap]);

  return (
    <View style={s.wrap}>
      <View style={{ height: treadHeight }} onLayout={onLayout}>
        {referenceTop != null && width > 0 && (
          <View style={[s.refLine, { top: referenceTop }]} pointerEvents="none">
            {/* Repeated segments rather than borderStyle:"dashed", which renders
                inconsistently across iOS and Android. */}
            {Array.from({ length: 40 }).map((_, i) => (
              <View key={i} style={s.refDash} />
            ))}
          </View>
        )}

        {/* Only the ribs are drawn. The grooves ARE the gaps between them —
            there is nothing to render for a groove, which is the whole point:
            its reading is the blank space, not a block. */}
        {segments.map((seg, k) => {
          // Nothing at all is drawn for a groove: its reading IS the gap, and
          // the ribs either side now carry that depth in their top corners.
          if (seg.groove != null) return null;
          const j = k / 2;
          const rib = ribs[j];
          const isFirst = j === 0;
          const isLast = j === ribs.length - 1;
          return (
            <Rib
              key={k}
              left={seg.left}
              width={seg.width}
              heightLeft={rib.heightLeft}
              heightRight={rib.heightRight}
              taper={taper}
              // Only the OUTER corner of each shoulder rounds hard. Rounding the
              // inner one too would turn the shoulder into a lozenge and lose
              // the groove wall it shares with its neighbour.
              radiusLeft={isFirst ? shoulder : CROWN}
              radiusRight={isLast ? shoulder : CROWN}
              colour={anyMeasured && rib.measured ? rubber : UNMEASURED}
            />
          );
        })}
      </View>

      {/* The belt the tread is moulded onto. */}
      <View style={[s.casing, { height: CASING_HEIGHT }]} />

      {/* Labels sit under the GROOVE they measure, not under a rib. Centred on
          the groove's own segment, and allowed a cell wider than the groove so
          "13.5mm" still fits over a 12px cut. */}
      <View style={{ height: 18, marginTop: 7 }}>
        {segments.map((seg, k) => {
          if (seg.groove == null) return null;
          const g = grooves[seg.groove];
          const cell = seg.width + LABEL_OVERHANG * 2;
          return (
            <View
              key={k}
              style={{
                position: "absolute",
                left: seg.left + seg.width / 2 - cell / 2,
                width: cell,
                alignItems: "center",
              }}
            >
              <Text style={[s.labelText, { color: g.labelColour }]} numberOfLines={1}>
                {g.mm == null ? "—" : `${g.mm}mm`}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Shown whenever the tread was measured — including when it is wearing
          evenly, which is a finding, not a blank. */}
      {showUnevenWear && anyMeasured && (
        <View style={s.wearRow}>
          <TyreWearPill wear={unevenWear ?? null} readings={readings} axleSide={axleSide} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 10 },

  refLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    overflow: "hidden",
    zIndex: 1,
  },
  refDash: { width: 4, height: 1, backgroundColor: "#9CA3AF" },

  // Same black as the ribs. This was a lighter grey, which drew a visible band
  // across the bottom of the drawing and made the tread look like it was sitting
  // on a separate object rather than being moulded onto one.
  casing: {
    backgroundColor: RUBBER,
    borderBottomLeftRadius: 9,
    borderBottomRightRadius: 9,
  },

  labelText: { fontSize: 11, fontWeight: "700" },

  wearRow: { marginTop: 9 },
});
