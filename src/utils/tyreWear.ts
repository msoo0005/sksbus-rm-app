// Derived tyre-inspection findings: the uneven-wear classifier and the
// pass/monitor/reject verdict.
//
// !! MIRRORED IN lambda/index.mjs (search: "DERIVED INSPECTION FINDINGS") !!
// !! KEEP THE TWO IN STEP — the fixtures at the bottom are the spec for both !!
//
// Duplicated rather than shared because there is no shared module path between
// the two halves of this repo: the Lambda is a single plain .mjs deployed as-is
// with no bundler and no package.json, the app is TypeScript compiled by Metro.
// Standing up a build step to share sixty lines of dependency-free arithmetic
// would cost more than it saves.
//
// Why both sides need it: the client shows the technician a live verdict as
// they type, offline, on a depot floor; the server derives it again on write
// because the stored verdict must never be whatever the client felt like
// sending.

/**
 * The four causes this classifier names, plus a neutral flag and two legacy
 * members.
 *
 * 'irregular' is NOT a cause — it is the shape that matched none of the four,
 * kept visible (and still worth a MONITOR) rather than reported as clean.
 *
 * LEGACY, never written by this code — only read back off rows stored before
 * migration 015:
 *   'alignment' — the un-splittable merge of toe-in and toe-out that existed
 *                 while no orientation convention was recorded.
 *   'imbalance' — the old name for what is now 'irregular'. Left unrewritten so
 *                 a legacy fallthrough stays distinguishable from a new one.
 */
export type UnevenWearType =
  | "toe_in"
  | "toe_out"
  | "under_inflation"
  | "over_inflation"
  | "irregular"
  | "alignment"
  | "imbalance";

export type TyreVerdict = "pass" | "monitor" | "reject";

// The spread between the deepest and shallowest groove on one tyre that means
// it is wearing unevenly rather than just imperfectly. Inclusive: a spread of
// exactly 1.5mm counts, which is what makes 12/13.5/13.5/13.5 classify at all.
export const UNEVEN_WEAR_SPREAD_MM = 1.5;

// Verdict thresholds, applied to the tyre's SHALLOWEST groove.
export const TYRE_REJECT_TREAD_MM = 5.0;
export const TYRE_MONITOR_TREAD_MM = 7.0;

const INSPECTION_RESULT_RANK: Record<TyreVerdict, number> = { pass: 0, monitor: 1, reject: 2 };

function worstResult(a: TyreVerdict, b: TyreVerdict): TyreVerdict {
  return INSPECTION_RESULT_RANK[a] >= INSPECTION_RESULT_RANK[b] ? a : b;
}

/**
 * Accepts the form's raw strings as well as persisted numbers.
 *
 * A blank cell is "not measured yet", NOT zero — note that Number("") is 0, so
 * coercing directly would read a half-filled form as a tyre with a 0mm groove
 * and show the technician a "reject" verdict and a bogus wear pattern while
 * they were still typing. Blanks are dropped instead.
 */
export function parseReadings(values: (string | number | null | undefined)[]): number[] {
  const out: number[] = [];
  for (const v of values ?? []) {
    if (v == null) continue;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (!trimmed) continue;
      const n = Number(trimmed);
      if (Number.isFinite(n) && n >= 0) out.push(n);
      continue;
    }
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out.push(n);
  }
  return out;
}

/** Which side of the bus a wheel is on. Mirrors TYRE_MOUNTING.axle_side. */
export type AxleSide = "left" | "right";

/**
 * The edge of the bus that groove 1 is always measured from.
 *
 * "left" means the kerb side in left-hand traffic. Change this one value and
 * every reading flips meaning, so it is named rather than buried in a
 * comparison — and the inspection form captions itself from the same constant,
 * so the screen can never disagree with the classifier about which edge box 1 is.
 */
export const READING_ANCHOR: AxleSide = "left";

/**
 * Put readings into the canonical outer-to-inner order.
 *
 * A wheel on the anchor side already starts at its outboard shoulder; a wheel on
 * the far side starts at its inboard one and is reversed.
 */
export function toOuterToInner<T>(readings: T[], axleSide?: AxleSide | null): T[] {
  if (!axleSide || axleSide === READING_ANCHOR) return readings;
  return [...readings].reverse();
}

/** What box 1 is physically measuring, for this wheel. */
export const readingStartsAtOuterEdge = (axleSide?: AxleSide | null) =>
  !axleSide || axleSide === READING_ANCHOR;

export type UnevenWearResult = { type: UnevenWearType | null; spread: number | null };

/**
 * Classify a tyre's groove readings by the CAUSE of any uneven wear.
 *
 * READING ORDER, and why the wheel's side is needed.
 *
 * Readings are recorded against a fixed edge of the BUS, not of the tyre:
 * groove 1 is always the kerb-side edge (see READING_ANCHOR). That is one
 * instruction a technician can follow at any wheel without working out which
 * face points outward — but it means the same array means opposite things on
 * opposite sides. On a LEFT wheel the kerb-side edge IS the outboard shoulder,
 * so the array already runs outer-to-inner. On a RIGHT wheel it is the inboard
 * shoulder, so the array runs inner-to-outer and has to be reversed first.
 *
 * Toe-in and toe-out are the same gradient with opposite signs, so getting this
 * wrong does not blur the answer, it inverts it: 5/5/7/8 is toe-in on the left
 * of the bus and toe-out on the right. `axleSide` is what resolves it, and the
 * app has it for every mounted tyre.
 *
 * Under- and over-inflation are symmetric about the tread centre and so survive
 * a reversal unchanged; only the toe pair depends on this.
 *
 * Omitting `axleSide` treats the readings as already outer-to-inner. That is the
 * canonical internal form, and it is what rows stored before this convention
 * carry — their true order is unknown, so this is an assumption, not a fact.
 *
 * CAVEAT — camber produces the same one-sided gradient as toe: positive camber
 * mimics toe-in, negative mimics toe-out. The physical tell for toe is
 * feathering, a sawtooth edge felt by hand, which is not a depth. So 'toe_in'
 * and 'toe_out' are the most likely cause of that shape rather than a certainty.
 * The labels state it plainly all the same — a hedge in every pill ("likely
 * toe-in") bought nothing a technician could act on differently, and made the
 * common case harder to read. Anyone acting on a toe finding should still check
 * the tread edges by hand before booking alignment work.
 */
export function classifyUnevenWear(
  readings: (string | number | null | undefined)[],
  axleSide?: AxleSide | null,
): UnevenWearResult {
  const v = toOuterToInner(parseReadings(readings), axleSide);
  if (v.length < 3) return { type: null, spread: null };

  const max = Math.max(...v);
  const min = Math.min(...v);
  // Rounded to one decimal to match TYRE_TREAD.tread_thickness_mm's
  // DECIMAL(4,1), so the shown spread can't disagree with the stored one.
  const spread = Math.round((max - min) * 10) / 10;
  if (spread < UNEVEN_WEAR_SPREAD_MM) return { type: null, spread };

  const shoulders = [v[0], v[v.length - 1]];
  const centre = v.slice(1, -1);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // From here the tyre HAS an issue — the spread said so. All that is left is to
  // name it, and a named cause is always more use than "irregular", so the two
  // physical signals are read off the profile and the stronger one wins.
  //
  //   inflation — where the CENTRE sits against the two SHOULDERS. Positive: the
  //               shoulders are the worn part, so the tyre has been running on
  //               its edges (under-inflated). Negative: the crown is worn
  //               (over-inflated). Symmetric about the tread centre, so it
  //               carries no direction and is safe whatever the groove order.
  //
  //   toe       — where the INNER shoulder sits against the OUTER one. Positive:
  //               the outer edge is worn (toe-in). Negative: the inner (toe-out).
  //               Purely antisymmetric — it is nothing BUT direction.
  //
  // Ties go to inflation: it is the commoner cause, and it is the claim that
  // does not depend on the readings having been taken outer-to-inner.
  //
  // This replaced four all-or-nothing shape tests — both shoulders strictly
  // below the whole centre, the centre strictly below both shoulders, and two
  // monotonic runs. They agree with this rule on every shape they DID match, but
  // anything that missed all four fell to 'irregular' however obvious its
  // profile: 6.7 / 8 / 6.5 / 6.9 has its shoulders a clear 0.45mm below its
  // centre and was reported as having no identifiable cause.
  const inflation = avg(centre) - avg(shoulders);
  const toe = v[v.length - 1] - v[0];

  if (Math.abs(inflation) >= Math.abs(toe)) {
    if (inflation > 0) return { type: "under_inflation", spread };
    if (inflation < 0) return { type: "over_inflation", spread };
  } else {
    return { type: toe > 0 ? "toe_in" : "toe_out", spread };
  }

  // Both signals are exactly zero. The tread varies — the spread said so — but
  // symmetrically AND with level shoulders, so no cause fits it better than any
  // other and naming one would be invention. e.g. 12 / 10 / 14 / 12.
  return { type: "irregular", spread };
}

/**
 * The pass/monitor/reject verdict, derived from what was measured rather than
 * chosen from a dropdown.
 *
 * NOTE: a derived 'reject' is a finding about the READING, not an instruction to
 * retire the tyre — nothing here or on the server changes tyre_status.
 */
export function deriveInspectionResult(args: {
  minTread: number | null;
  sidewallCondition?: "ok" | "not_ok" | null;
  unevenWearType?: UnevenWearType | null;
}): TyreVerdict {
  const { minTread, sidewallCondition, unevenWearType } = args;
  let result: TyreVerdict = "pass";
  if (minTread != null && Number.isFinite(minTread)) {
    if (minTread < TYRE_REJECT_TREAD_MM) result = "reject";
    else if (minTread < TYRE_MONITOR_TREAD_MM) result = "monitor";
  }
  if (sidewallCondition === "not_ok") result = worstResult(result, "monitor");
  if (unevenWearType) result = worstResult(result, "monitor");
  return result;
}

/** Everything the form needs to show, from the readings alone. */
export function evaluateTyre(args: {
  readings: (string | number | null | undefined)[];
  sidewallCondition?: "ok" | "not_ok" | null;
  /** The wheel's side, which decides what groove 1 was measuring. */
  axleSide?: AxleSide | null;
}): { minTread: number | null; verdict: TyreVerdict; wear: UnevenWearResult } {
  const parsed = parseReadings(args.readings);
  const minTread = parsed.length ? Math.min(...parsed) : null;
  const wear = classifyUnevenWear(args.readings, args.axleSide);
  return {
    minTread,
    wear,
    verdict: deriveInspectionResult({
      minTread,
      sidewallCondition: args.sidewallCondition,
      unevenWearType: wear.type,
    }),
  };
}

/**
 * What to LABEL a tyre with, reconciling the STORED finding against the readings
 * shown next to it.
 *
 * A stored NULL does not mean "wearing evenly". It also means "nobody classified
 * this row": every inspection imported by migration 010 predates the
 * uneven_wear_type column that 014 added, and 014 deliberately rewrote no data —
 * so a large batch of real, visibly uneven inspections carries NULL. Reporting
 * those as evenly worn is worse than reporting nothing, because it is a positive
 * claim about a safety finding.
 *
 * So when nothing is stored, the readings are classified on the spot.
 *
 * ASSUMPTION, made deliberately: that a legacy row's grooves were recorded
 * outer-to-inner, like the form now requires. Toe-in and toe-out are the same
 * gradient with opposite signs, so a row measured the other way round will name
 * the opposite direction. This used to hedge — a legacy gradient showed "cause
 * not recorded" rather than risk it — but a named cause is more use than a
 * shrug, and outer-to-inner is what technicians were doing anyway. The hedge
 * survives only where there is nothing to classify FROM: a list row that has a
 * stored spread and no readings knows the tyre is uneven and cannot know why.
 *
 * A stored LEGACY label loses to the readings. 'alignment' is the old merged
 * bucket for toe-in and toe-out and 'imbalance' the old name for 'irregular';
 * both say strictly less than the readings themselves now do.
 */
export type WearLabel =
  | { kind: "even" }
  | { kind: "known"; type: UnevenWearType }
  | { kind: "uneven" };

/** Written only by code that predates migration 015 — see above. */
const LEGACY_WEAR_TYPES: UnevenWearType[] = ["alignment", "imbalance"];

export function wearForDisplay(
  stored: UnevenWearType | null | undefined,
  evidence: {
    readings?: (string | number | null | undefined)[];
    /** Required alongside `readings` for the toe direction to be right. */
    axleSide?: AxleSide | null;
    spreadMm?: number | null;
  } = {},
): WearLabel {
  const hasReadings = !!evidence.readings?.length;
  const storedIsLegacy = !!stored && LEGACY_WEAR_TYPES.includes(stored);

  if (stored && !(storedIsLegacy && hasReadings)) return { kind: "known", type: stored };

  if (hasReadings) {
    const { type } = classifyUnevenWear(evidence.readings!, evidence.axleSide);
    return type ? { kind: "known", type } : { kind: "even" };
  }

  // Only a spread to go on — enough to know THAT it is uneven, never which.
  if (evidence.spreadMm != null && evidence.spreadMm >= UNEVEN_WEAR_SPREAD_MM) {
    return { kind: "uneven" };
  }

  return { kind: "even" };
}

// i18n key suffixes, so callers read t(`tyres.wear.${type}`) rather than
// carrying their own switch.
//
// Total over UnevenWearType on purpose: the legacy members are still sitting in
// TYRE_INSPECTION rows written before migration 015, and every display site
// indexes this map by whatever the server returned. Dropping them would render
// `undefined` on historic inspections.
export const UNEVEN_WEAR_I18N_KEY: Record<UnevenWearType, string> = {
  toe_in: "tyres.wear.toeIn",
  toe_out: "tyres.wear.toeOut",
  under_inflation: "tyres.wear.underInflation",
  over_inflation: "tyres.wear.overInflation",
  irregular: "tyres.wear.irregular",
  // Legacy — pre-015 rows only.
  alignment: "tyres.wear.alignment",
  imbalance: "tyres.wear.imbalance",
};

/**
 * How a wear classification is coloured and labelled wherever it is shown.
 *
 * The inspection screens used to lead with the derived pass/monitor/reject
 * verdict and each kept its own copy of the palette AND its own hard-coded
 * English labels ("Pass", "Monitor", "Reject") that the Malay locale never
 * reached. The verdict is still derived and stored — it drives the fleet
 * summary and the nightly digest — but it is no longer what the inspection UI
 * reports, so these two helpers are the single place that answers "what does
 * this classification look like".
 */
export const WEAR_TONE = {
  even: { fg: "#16A34A", bg: "#F0FDF4" },
  flagged: { fg: "#B45309", bg: "#FFFBEB" },
} as const;

export const wearToneFor = (type: UnevenWearType | null | undefined) =>
  type ? WEAR_TONE.flagged : WEAR_TONE.even;

/** Translation key for a classification, including the "wearing evenly" case. */
export const wearLabelKey = (type: UnevenWearType | null | undefined) =>
  type ? UNEVEN_WEAR_I18N_KEY[type] : "tyres.wear.none";

// ---------------------------------------------------------------------------
// FIXTURES — the shared spec. Both this file and the Lambda copy must satisfy
// every row. The first two are the worked examples the behaviour was specified
// from, and are mirror images of each other — that pair is what proves the
// outer/inner convention is actually being honoured end to end.
//
// Readings are OUTER -> INNER; readings[0] is the outboard shoulder.
//
// THE 1.5mm SPREAD IS THE ONLY THRESHOLD. It decides whether the tyre has an
// issue at all; past it, the SHAPE decides which issue, by comparing positions
// rather than clearing any further margin. The last two rows are the ones that
// pin this down — both sit exactly on 1.5mm and both have an unmistakable
// shape, and both were reported as 'irregular' while the threshold was being
// applied a second time inside each shape test.
//
//   readings                 -> type             spread
//   [12, 13.5, 13.5, 13.5]   -> toe_in           1.5
//   [13.5, 13.5, 13.5, 12]   -> toe_out          1.5
//   [10, 12, 12, 10]         -> under_inflation  2.0
//   [13, 10, 10, 13]         -> over_inflation   3.0
//   [12, 12, 12, 12]         -> null             0.0
//   [12, 12, 12, 13]         -> null             1.0   (under the threshold)
//   [9, 13, 13]              -> toe_in           4.0   (3-groove LM 668)
//   [13, 13, 9]              -> toe_out          4.0
//   [11, 12.5, 12.5, 11.5]   -> under_inflation  1.5
//   [13, 11.5, 11.5, 12.5]   -> over_inflation   1.5
//
// A named cause is preferred over 'irregular' wherever the profile leans one
// way at all. These four used to fall through to 'irregular':
//   [6.7, 8, 6.5, 6.9]       -> under_inflation  1.5   shoulders 0.45mm low
//   [12, 9, 13, 12]          -> over_inflation   4.0   centre 1.0mm low
//   [9, 11, 9.5, 11.2]       -> toe_in           2.2   outer 2.2mm low
//   [13, 12, 13.5, 11]       -> toe_out          2.5   inner 2.0mm low
//
// 'irregular' now needs BOTH signals to be exactly zero — a tread that varies
// symmetrically and with level shoulders, so nothing fits better than anything:
//   [12, 10, 14, 12]         -> irregular        4.0
//
//   verdicts
//   minTread 3.0                        -> reject
//   minTread 6.0                        -> monitor
//   minTread 9.0                        -> pass
//   minTread 9.0 + sidewall not_ok      -> monitor
//   minTread 9.0 + any uneven wear      -> monitor
// ---------------------------------------------------------------------------
