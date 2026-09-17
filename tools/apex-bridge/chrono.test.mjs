// Correctness checks for the MegaKart chrono. Run: node chrono.test.mjs
// These encode the rules that, if wrong, make the system CONFIDENTLY wrong — which is worse
// than showing nothing. Uses real values from the captured session where possible.

import { createChrono } from "./chrono.mjs";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const mk = (opts = {}) => createChrono({ resolveDriver: () => null, ...opts });
const S = 1_000_000; // one second in microseconds
// A realistic hardware-clock base. ts_us is a free-running counter (real value from capture.log),
// never near zero — and the engine rejects <= 0 as malformed, so tests must use real magnitudes.
const T0 = 3998635319237000;
const at = (sec) => T0 + sec * S;

// ---------------------------------------------------------------- the off-by-one
{
  const c = mk();
  c.start({ minLapMs: 0 });
  c.onPassing({ transponder: "23", tsUs: at(100), flags: "2" });
  eq("one crossing = 0 completed laps", c.snapshot().classification.rows[0].laps, 0);
  c.onPassing({ transponder: "23", tsUs: at(130), flags: "2" });
  eq("two crossings = 1 completed lap", c.snapshot().classification.rows[0].laps, 1);
  eq("that lap is 30.000s", c.snapshot().classification.rows[0].lastLapMs, 30000);
}

// ---------------------------------------------------------------- best / last / total
{
  const c = mk();
  c.start({ minLapMs: 0 });
  [0, 30, 55, 90].forEach((sec) => c.onPassing({ transponder: "7", tsUs: at(sec), flags: "2" }));
  const r = c.snapshot().classification.rows[0];
  eq("laps from 4 crossings", r.laps, 3);
  eq("last lap = 90-55", r.lastLapMs, 35000);
  eq("best lap = 55-30", r.bestLapMs, 25000);
  eq("total = last - first", r.totalTimeMs, 90000);
}

// ---------------------------------------------------------------- double-read guard
{
  const c = mk();
  c.start({ minLapMs: 1500 });
  c.onPassing({ transponder: "9", tsUs: at(10), flags: "2" });
  c.onPassing({ transponder: "9", tsUs: at(10) + 200_000, flags: "2" }); // 0.2s later — same pass
  const snap = c.snapshot();
  eq("double read excluded from the board", snap.classification.rows[0].crossings, 1);
  eq("exclusion is visible", snap.classification.integrity.excludedByGuard, 1);
  eq("but the raw crossing is KEPT in the ledger", snap.ledgerSize, 2);
}

// -------------------------------------------------- the guard must never destroy evidence
// Regression guard for a real shipped bug: minLapMs defaulted to 1500ms, which measured
// against the production capture discarded 24 of 90 genuine intervals (27%) for transponder
// 23 — real laps of 332, 621, 731, 1031ms. Because filtering now happens at READ time, a
// wrong threshold is recoverable instead of fatal.
{
  const c = mk();
  c.start({ minLapMs: 1500 });
  // Four real sub-1.5s intervals taken from capture.log.
  let t = at(0);
  c.onPassing({ transponder: "23", tsUs: t, flags: "2" });
  for (const ms of [731, 1031, 621, 903]) {
    t += ms * 1000;
    c.onPassing({ transponder: "23", tsUs: t, flags: "2" });
  }
  // The dangerous part: a bad threshold does not fail loudly, it QUIETLY UNDER-COUNTS.
  // True answer is 4 laps; the shipped 1500ms default reports 2.
  eq("bad threshold silently under-counts", c.snapshot().classification.rows[0].laps, 2);
  eq("all crossings still in the ledger", c.snapshot().ledgerSize, 5);

  // The operator lowers the guard and recomputes — no re-race required.
  const fixed = c.reclassify({ minLapMs: 250 });
  eq("recovered by recompute", fixed.classification.rows[0].laps, 4);
  eq("real 731ms lap recovered", fixed.classification.rows[0].bestLapMs, 621);
  eq("nothing excluded at the sane threshold", fixed.classification.integrity.excludedByGuard, 0);
}

// ---------------------------------------------------------------- safe default
{
  const c = mk();
  c.start(); // no explicit threshold
  eq("default guard is small enough for real laps", c.snapshot().minLapMs <= 250, true);
  let t = at(0);
  c.onPassing({ transponder: "23", tsUs: t, flags: "2" });
  for (const ms of [332, 621, 731]) { t += ms * 1000; c.onPassing({ transponder: "23", tsUs: t, flags: "2" }); }
  eq("sub-second real laps survive the default", c.snapshot().classification.rows[0].laps, 3);
}

// ---------------------------------------------------------------- exact duplicates
{
  const c = mk();
  c.start(); // default 250ms
  c.onPassing({ transponder: "5", tsUs: at(10), flags: "2" });
  c.onPassing({ transponder: "5", tsUs: at(10), flags: "2" }); // same instant, reported twice
  eq("0ms duplicate still removed by default", c.snapshot().classification.rows[0].crossings, 1);
}

// ---------------------------------------------------------------- position & gaps
{
  const c = mk();
  c.start({ minLapMs: 0 });
  // A: 3 laps finishing at t=100. B: 3 laps finishing at t=102. C: 2 laps.
  [0, 40, 70, 100].forEach((s2) => c.onPassing({ transponder: "A", tsUs: at(s2), flags: "2" }));
  [1, 41, 71, 102].forEach((s2) => c.onPassing({ transponder: "B", tsUs: at(s2), flags: "2" }));
  [2, 45, 80].forEach((s2) => c.onPassing({ transponder: "C", tsUs: at(s2), flags: "2" }));
  const rows = c.snapshot().classification.rows;
  eq("leader is A", rows[0].transponder, "A");
  eq("A shows LEADER", rows[0].gapText, "LEADER");
  eq("B is second", rows[1].transponder, "B");
  eq("B gap is +2.000", rows[1].gapText, "+2.000");
  eq("C is lapped-down by 1", rows[2].gapText, "+1 T");
}

// ---------------------------------------------------------------- our window, not GoKarts'
{
  const c = mk();
  c.start({ minLapMs: 0 });
  c.onPassing({ transponder: "0", tsUs: at(5), flags: "65282" });  // GoKarts session start
  c.onPassing({ transponder: "23", tsUs: at(10), flags: "2" });
  c.onPassing({ transponder: "23", tsUs: at(40), flags: "2" });
  c.onPassing({ transponder: "0", tsUs: at(50), flags: "65285" }); // GoKarts session end
  const snap = c.snapshot();
  eq("markers do not become pilots", snap.classification.rows.length, 1);
  eq("markers recorded as context", snap.upstreamMarkers.length, 2);
  eq("still counting after GoKarts' end marker", snap.running, true);
  c.onPassing({ transponder: "23", tsUs: at(70), flags: "2" });
  eq("lap counted past GoKarts' end marker", c.snapshot().classification.rows[0].laps, 2);
}

// ---------------------------------------------------------------- nothing before start
{
  const c = mk();
  c.onPassing({ transponder: "23", tsUs: at(1), flags: "2" }); // before start
  c.start({ minLapMs: 0 });
  c.onPassing({ transponder: "23", tsUs: at(2), flags: "2" });
  eq("pre-start crossings ignored", c.snapshot().classification.rows[0].crossings, 1);
}

// ---------------------------------------------------------------- integrity
{
  const c = mk();
  c.start({ minLapMs: 0 });
  c.onPassing({ transponder: "23", tsUs: at(10), flags: "2" });
  c.noteFeedDrop();
  c.onPassing({ transponder: "23", tsUs: at(40), flags: "2" });
  const res = c.stop().classification;
  eq("feed drop flags result incomplete", res.integrity.complete, false);
  eq("feed drop counted", res.integrity.feedDrops, 1);
}

// ---------------------------------------------------------------- real captured values
{
  // From capture.log: transponder 23, GoKarts reported lap 2 at 0.731s after lap 1.
  // We must reach the same lap time from timestamps alone.
  const c = mk();
  c.start({ minLapMs: 0 });
  c.onPassing({ transponder: "23", tsUs: 3998635319237000, flags: "2" });
  c.onPassing({ transponder: "23", tsUs: 3998635319968000, flags: "786434" });
  eq("real capture: lap time 731ms from timestamps", c.snapshot().classification.rows[0].lastLapMs, 731);
  eq("real capture: 1 completed lap", c.snapshot().classification.rows[0].laps, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
