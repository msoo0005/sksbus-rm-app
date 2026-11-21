// Tests the pure job rules (v2.0.0 Part C) in lambda/index.mjs without its
// DB/S3 setup.
//
//   node --test lambda/scripts/test_job_rules.mjs
//
// Same approach as test_puspakom_rules.mjs: cut out the block between the JOB
// RULES markers, export every top-level name in it, and import that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../index.mjs", import.meta.url)), "utf8");
const start = src.indexOf("// ===================== JOB RULES (pure) =====================");
const end = src.indexOf("// ===================== END JOB RULES =====================");
assert.ok(start > 0 && end > start, "JOB RULES markers not found in index.mjs");
const block = src.slice(start, end);
const names = [...block.matchAll(/^(?:function|const)\s+(\w+)/gm)].map((m) => m[1]);
const R = await import(
  "data:text/javascript," + encodeURIComponent(`${block}\nexport { ${names.join(", ")} };`)
);

const MIN = 60000;

test("transitions follow the lifecycle and nothing else", () => {
  assert.equal(R.jobNextState("approved", "accept"), "accepted");
  assert.equal(R.jobNextState("accepted", "arrive"), "arrived");
  assert.equal(R.jobNextState("arrived", "complete"), "pending_approval");
  assert.equal(R.jobNextState("pending_approval", "send_back"), "arrived");
  assert.equal(R.jobNextState("pending_approval", "approve"), "closed");
  // Not allowed:
  assert.equal(R.jobNextState("arrived", "approve"), null);
  assert.equal(R.jobNextState("accepted", "complete"), null);
  assert.equal(R.jobNextState("closed", "send_back"), null);
  assert.equal(R.jobNextState("approved", "nope"), null);
});

test("legacy 'open' rows are placed by how far they got", () => {
  assert.equal(R.jobState("open", { technician_user_id: null }), "approved");
  assert.equal(R.jobState("open", { technician_user_id: 3, job_odometer: null }), "accepted");
  assert.equal(R.jobState("open", { technician_user_id: 3, job_odometer: 1200 }), "arrived");
  assert.equal(R.jobState("done"), "closed");
  assert.equal(R.jobState("completed"), "closed");
  assert.equal(R.jobState("PENDING_APPROVAL"), "pending_approval");
});

test("status groups for the Sort by menu", () => {
  assert.equal(R.jobStatusGroup("pending_approval"), 1);
  assert.equal(R.jobStatusGroup("arrived"), 2);
  assert.equal(R.jobStatusGroup("accepted"), 3);
  assert.equal(R.jobStatusGroup("approved"), 4);
  assert.equal(R.jobStatusGroup("closed"), null);
});

test("Complete Job names the first missing item", () => {
  assert.equal(R.jobCompleteProblem({ taskCount: 0, afterSlots: [] }).code, "TASK_REQUIRED");
  const p = R.jobCompleteProblem({ taskCount: 2, afterSlots: ["dashboard", "back", "left"] });
  assert.equal(p.code, "AFTER_PHOTOS_REQUIRED");
  assert.deepEqual(p.missing, ["front"]);
  assert.match(p.message, /1\/2/);
  assert.equal(R.jobCompleteProblem({ taskCount: 1, afterSlots: ["front", "dashboard"] }), null);
  assert.equal(R.jobCompleteProblem({ taskCount: 1, afterSlots: [...R.JOB_AFTER_SLOTS] }), null);
});

test("odometer: digits, not 0, within last..last+2000", () => {
  assert.equal(R.odometerProblem("325712", 325000), null);
  assert.equal(R.odometerProblem("325000", 325000), null);
  assert.equal(R.odometerProblem("327000", 325000), null);
  assert.equal(R.odometerProblem("327001", 325000), "ODOMETER_HIGH");
  assert.equal(R.odometerProblem("400000", 325689), "ODOMETER_HIGH");
  assert.equal(R.odometerProblem("324999", 325000), "Check the reading");
  assert.equal(R.odometerProblem("0", null), "Check the reading");
  assert.equal(R.odometerProblem("12.5", null), "Check the reading");
  assert.equal(R.odometerProblem("1,200", null), "Check the reading");
  assert.equal(R.odometerProblem(150, null), null);
});

test("reference number", () => {
  assert.equal(R.jobRefNo("2026-11-13", 1), "SKSC-JCR-2026-11-13-01");
  assert.equal(R.jobRefNo("2026-11-13", 12), "SKSC-JCR-2026-11-13-12");
  assert.equal(R.jobRefNo("2026-11-13", 104), "SKSC-JCR-2026-11-13-104");
});

test("late arrival: 90 min, then every 30 min, only while accepted", () => {
  const acc = Date.UTC(2026, 10, 13, 2, 0); // 10:00 MYT
  const base = { state: "accepted", acceptedAt: acc, limitMin: 90, repeatMin: 30 };

  let s = R.jobLateState({ ...base, now: acc + 89 * MIN });
  assert.equal(s.late, false);
  assert.equal(s.updateDue, false);

  s = R.jobLateState({ ...base, now: acc + 91 * MIN });
  assert.equal(s.late, true);
  assert.equal(s.updateDue, true);
  assert.equal(s.promptDue, true);

  // Pushed at 91 min: no second push until the repeat interval.
  s = R.jobLateState({ ...base, lastPromptAt: acc + 91 * MIN, now: acc + 100 * MIN });
  assert.equal(s.promptDue, false);
  s = R.jobLateState({ ...base, lastPromptAt: acc + 91 * MIN, now: acc + 121 * MIN });
  assert.equal(s.promptDue, true);

  // Update sent at 95 min: nothing due until 125 min.
  s = R.jobLateState({ ...base, lastDelayAt: acc + 95 * MIN, lastPromptAt: acc + 91 * MIN, now: acc + 110 * MIN });
  assert.equal(s.late, true);
  assert.equal(s.updateDue, false);
  s = R.jobLateState({ ...base, lastDelayAt: acc + 95 * MIN, lastPromptAt: acc + 91 * MIN, now: acc + 126 * MIN });
  assert.equal(s.updateDue, true);
  assert.equal(s.promptDue, true);

  // Arrived: never late.
  s = R.jobLateState({ ...base, state: "arrived", now: acc + 300 * MIN });
  assert.equal(s.late, false);
});
