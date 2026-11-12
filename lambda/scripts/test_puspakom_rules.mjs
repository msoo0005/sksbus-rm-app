// Tests the pure PUSPAKOM rules in lambda/index.mjs without its DB/S3 setup.
//
//   node --test lambda/scripts/test_puspakom_rules.mjs
//
// index.mjs can't be imported here (it needs mysql2, the AWS SDK and env vars),
// so this cuts out the block between the PUSPAKOM RULES markers, exports every
// top-level name in it, and imports that as a module.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../index.mjs", import.meta.url)), "utf8");
const start = src.indexOf("// ===================== PUSPAKOM RULES (pure) =====================");
const end = src.indexOf("// ===================== END PUSPAKOM RULES =====================");
assert.ok(start > 0 && end > start, "PUSPAKOM RULES markers not found in index.mjs");
const block = src.slice(start, end);
const names = [...block.matchAll(/^(?:function|const)\s+(\w+)/gm)].map((m) => m[1]);
const R = await import(
  "data:text/javascript," + encodeURIComponent(`${block}\nexport { ${names.join(", ")} };`)
);
const S = R.PSP_STATUS;

// 09:00 MYT on a date = 01:00 UTC
const myt = (date, hhmm = "09:00") => new Date(`${date}T${hhmm}:00+08:00`);

test("next due: +6 calendar months, clamped to month end", () => {
  assert.equal(R.pspNextDue("2026-05-13"), "2026-11-13");
  assert.equal(R.pspNextDue("2026-08-31"), "2027-02-28");
  assert.equal(R.pspNextDue("2027-08-31"), "2028-02-29"); // leap year
  assert.equal(R.pspNextDue("2026-12-31"), "2027-06-30");
  assert.equal(R.pspNextDue(null), null);
});

test("MYT date: late UTC evening is the next day in Malaysia", () => {
  assert.equal(R.pspMytDate(new Date("2026-11-12T17:00:00Z")), "2026-11-13");
  assert.equal(R.pspMytDate(new Date("2026-11-12T15:59:00Z")), "2026-11-12");
});

test("status without an open booking", () => {
  const now = myt("2026-11-12");
  assert.equal(R.pspBusStatus({ nextDue: null, open: null, now }), S.NOT_BOOKED, "never passed starts Not booked");
  assert.equal(R.pspBusStatus({ nextDue: "2027-02-01", open: null, now }), S.NOT_DUE);
  assert.equal(R.pspBusStatus({ nextDue: "2027-01-11", open: null, now }), S.NOT_BOOKED, "exactly 60 days");
  assert.equal(R.pspBusStatus({ nextDue: "2027-01-12", open: null, now }), S.NOT_DUE, "61 days");
  assert.equal(R.pspBusStatus({ nextDue: "2026-11-12", open: null, now }), S.NOT_BOOKED, "due today is not overdue");
  assert.equal(R.pspBusStatus({ nextDue: "2026-11-11", open: null, now }), S.OVERDUE_NOT_BOOKED);
});

test("status with an open booking", () => {
  const now = myt("2026-11-12");
  const open = (o) => ({ type: "PERIODIC", scheduledAt: myt("2026-11-20"), preSubmitted: false, ...o });
  assert.equal(R.pspBusStatus({ nextDue: "2026-11-30", open: open(), now }), S.BOOKED);
  assert.equal(R.pspBusStatus({ nextDue: null, open: open(), now }), S.BOOKED, "first ever booking");
  assert.equal(R.pspBusStatus({ nextDue: "2026-11-15", open: open(), now }), S.OVERDUE_BOOKED, "booking after due");
  assert.equal(R.pspBusStatus({ nextDue: "2026-11-01", open: open(), now }), S.OVERDUE_BOOKED, "due passed");
  assert.equal(R.pspBusStatus({ nextDue: "2026-11-01", open: open({ preSubmitted: true }), now }), S.PRECHECK_DONE);
  assert.equal(R.pspBusStatus({ nextDue: "2026-11-30", open: open({ type: "REINSPECTION" }), now }), S.FAILED_PENDING);
  const passed = myt("2026-11-12", "08:59");
  assert.equal(R.pspBusStatus({ nextDue: "2026-11-30", open: open({ scheduledAt: passed }), now }), S.INSPECTED_UPDATE);
  assert.equal(
    R.pspBusStatus({ nextDue: "2026-11-30", open: open({ type: "REINSPECTION", scheduledAt: passed }), now }),
    S.INSPECTED_UPDATE,
    "re-inspection time passing also asks for a result"
  );
});

test("counts follow the spec's groupings", () => {
  const c = R.pspCounts([
    S.OVERDUE_NOT_BOOKED, S.OVERDUE_BOOKED, S.NOT_BOOKED, S.NOT_BOOKED,
    S.BOOKED, S.PRECHECK_DONE, S.INSPECTED_UPDATE, S.FAILED_PENDING, S.NOT_DUE,
  ]);
  assert.deepEqual(c, { overdue: 2, need_booking: 2, booked: 5, action: 4 });
});

test("technician pills", () => {
  assert.deepEqual(R.pspTechPill({ kind: "PRE" }), { pill: "PRECHECK_TODO", tab: "TODO" });
  assert.deepEqual(R.pspTechPill({ kind: "PRE", answered: 3 }), { pill: "IN_PROGRESS", tab: "TODO" });
  assert.deepEqual(R.pspTechPill({ kind: "PRE", answered: 44, submitted: true }), { pill: "SUBMITTED", tab: "DONE" });
  assert.deepEqual(R.pspTechPill({ kind: "RECHECK" }), { pill: "RECHECK_TODO", tab: "TODO" });
  assert.deepEqual(R.pspTechPill({ kind: "RECHECK", submitted: true }), { pill: "RECHECK_SUBMITTED", tab: "DONE" });
});

test("number bands", () => {
  const tag = R.pspAnswerTag;
  assert.equal(tag("TYRE", { tread_mm: 5.9, pressure_psi: 120 }), "REPLACE");
  assert.equal(tag("TYRE", { tread_mm: 6.0, pressure_psi: 107 }), "LOW");
  assert.equal(tag("TYRE", { tread_mm: 6.0, pressure_psi: 108 }), "OK");
  assert.equal(tag("TYRE", { tread_mm: 5, pressure_psi: 50 }), "REPLACE", "Replace outranks Low");
  assert.equal(tag("TYRE", { tread_mm: 8 }), "OK", "tag shows as soon as one number is typed");
  assert.equal(tag("TYRE", {}), null);
  assert.equal(tag("BRAKE", { pad_mm: 2.9 }), "REPLACE");
  assert.equal(tag("BRAKE", { pad_mm: 3.0 }), "CHECK_SOON");
  assert.equal(tag("BRAKE", { pad_mm: 5.0 }), "CHECK_SOON");
  assert.equal(tag("BRAKE", { pad_mm: 5.1 }), "OK");
  assert.equal(tag("OK_NG", { answer: "NG" }), "NG");
  assert.equal(tag("BODY", { answer: "NO_DAMAGE" }), "OK");
  assert.equal(tag("BODY", { answer: "DAMAGE" }), "DAMAGE");
});

test("number range validation", () => {
  assert.throws(() => R.pspValidateNumbers({ check_id: "C18", tread_mm: 26 }), /Check the number/);
  assert.throws(() => R.pspValidateNumbers({ check_id: "C18", pressure_psi: 120.5 }), /Check the number/);
  assert.throws(() => R.pspValidateNumbers({ check_id: "C19", pad_mm: -1 }), /Check the number/);
  assert.deepEqual(R.pspValidateNumbers({ check_id: "C18", tread_mm: "6.5", pressure_psi: 120 }), { tread: 6.5, psi: 120, pad: null });
});

test("row done rules", () => {
  const p = { photo_s3_key: "k" };
  assert.equal(R.pspAnswerDone("OK_NG", { answer: "OK" }), false, "photo required");
  assert.equal(R.pspAnswerDone("OK_NG", { ...p, answer: "OK" }), true);
  assert.equal(R.pspAnswerDone("OK_NG", { ...p, answer: "NG" }), false, "NG needs a reason");
  assert.equal(R.pspAnswerDone("OK_NG", { ...p, answer: "NG", ng_reason: "LOOSE" }), true);
  assert.equal(R.pspAnswerDone("OK_NG", { ...p, answer: "NG", ng_reason: "OTHER" }), false, "Other needs a note");
  assert.equal(R.pspAnswerDone("OK_NG", { ...p, answer: "NG", ng_reason: "OTHER", note: "x" }), true);
  assert.equal(R.pspAnswerDone("TYRE", { ...p, tread_mm: 7 }), false);
  assert.equal(R.pspAnswerDone("TYRE", { ...p, tread_mm: 7, pressure_psi: 0 }), true, "0 is a number");
  assert.equal(R.pspAnswerDone("BRAKE", { ...p, pad_mm: 4 }), true);
  const dmg = { x_pct: 10, y_pct: 20, where: "rear bumper", type: "DENT", photo_s3_key: "d" };
  assert.equal(R.pspAnswerDone("BODY", { ...p, answer: "NO_DAMAGE" }), true);
  assert.equal(R.pspAnswerDone("BODY", { ...p, answer: "DAMAGE", damages: [] }), false);
  assert.equal(R.pspAnswerDone("BODY", { ...p, answer: "DAMAGE", damages: [dmg] }), true);
  assert.equal(R.pspAnswerDone("BODY", { ...p, answer: "DAMAGE", damages: [dmg, { ...dmg, photo_s3_key: null }] }), false);
});

test("reference number", () => {
  assert.equal(R.pspRefNo("2026-05-06", 1), "SKSC-PKR-2026-05-06-01");
  assert.equal(R.pspRefNo("2026-05-06", 12), "SKSC-PKR-2026-05-06-12");
});
