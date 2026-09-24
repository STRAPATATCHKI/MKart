// The lap list behind a driver row in "Contrôle de course": every lap, its delta to that
// driver's best, and which drivers open by themselves.
//
// Unlike start-sequence.test.mjs this imports the real module instead of restating it: Node 24
// strips the type annotations on the way in, so there is no second copy of the arithmetic to
// drift away from the one the dashboard ships.
import { strict as assert } from "node:assert";
import test from "node:test";

import { fastestLapIndex, fmtDelta, fmtLap, hasLapList, isExpanded, lapRows }
  from "../components/timing/lap-rows.ts";

test("four laps are four rows, numbered the way the operator counts them", () => {
  const rows = lapRows({ lapTimesMs: [41_200, 39_988, 40_310, 39_500] });
  assert.equal(rows.length, 4, "the owner saw one lap where four were scored");
  assert.deepEqual(rows.map((r) => r.lap), [1, 2, 3, 4], "index 0 IS lap 1");
  assert.deepEqual(rows.map((r) => r.ms), [41_200, 39_988, 40_310, 39_500]);
});

test("every lap reads against the driver's own best", () => {
  const rows = lapRows({ lapTimesMs: [41_200, 39_988, 40_310, 39_500] });
  assert.deepEqual(rows.map((r) => r.delta), ["+1.700", "+0.488", "+0.810", null]);
  assert.deepEqual(rows.map((r) => r.best), [false, false, false, true]);
});

test("no delta is ever negative, whichever lap the chrono calls best", () => {
  const rows = lapRows({ lapTimesMs: [41_200, 39_988, 40_310], bestLapIndex: 0 });
  for (const r of rows) assert.ok(r.delta === null || r.delta.startsWith("+"), `negative delta: ${r.delta}`);
  assert.equal(rows[1].best, true, "a stale index is ignored in favour of the real fastest lap");
});

test("a tie goes to the lap that was set first", () => {
  const rows = lapRows({ lapTimesMs: [40_000, 39_500, 39_500] });
  assert.deepEqual(rows.map((r) => r.best), [false, true, false]);
  assert.equal(rows[2].delta, "+0.000", "the equal later lap still shows its gap of nothing");
});

test("a tie is the earliest lap even when the chrono names a later equal one", () => {
  // The chrono derives its index the same way, so a later equal index is a disagreement, not a
  // second valid answer: both ends of the wire must credit the lap that was set first.
  assert.equal(fastestLapIndex([40_000, 39_500, 39_500], 2), 1);
  assert.equal(fastestLapIndex([40_000, 39_500, 39_500], 1), 1, "the chrono's real answer");
  assert.equal(fastestLapIndex([40_000, 39_500, 39_500], null), 1, "no index sent: earliest wins");
});

test("an index that cannot be trusted is recomputed", () => {
  assert.equal(fastestLapIndex([40_000, 39_500], 7), 1, "out of range");
  assert.equal(fastestLapIndex([40_000, 39_500], -1), 1, "negative");
  assert.equal(fastestLapIndex([40_000, 39_500], 1.5), 1, "not a lap index at all");
  assert.equal(fastestLapIndex([40_000, 39_500], 0), 1, "points at a slower lap");
});

test("a single lap is its own best and is compared to nothing", () => {
  const rows = lapRows({ lapTimesMs: [42_015] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].best, true);
  assert.equal(rows[0].delta, null, "+0.000 against itself is noise, not information");
});

test("a driver who has not crossed yet has no laps to list", () => {
  assert.deepEqual(lapRows({ lapTimesMs: [] }), [], "prepared race, nobody across the line");
  assert.equal(fastestLapIndex([]), null);
  assert.equal(fastestLapIndex(undefined), null);
});

test("an older Timing Control degrades to the row it always showed", () => {
  // No lapTimesMs in the frame: the panel must not offer a drawer it cannot fill.
  const legacy = { lastLapMs: 40_000, bestLapMs: 39_500 };
  assert.equal(hasLapList(legacy), false);
  assert.deepEqual(lapRows(legacy), []);
  assert.equal(hasLapList({ lapTimesMs: [] }), true, "an empty array is still lap detail");
});

test("lap times keep the format the DERNIER column already used", () => {
  assert.equal(fmtLap(39_988), "39.988");
  assert.equal(fmtLap(61_500), "1:01.500", "seconds past the minute are padded");
  assert.equal(fmtLap(600_000), "10:00.000");
  assert.equal(fmtLap(null), "—");
  assert.equal(fmtLap(0), "0.000", "zero is a time, not a missing one");
});

test("deltas read in seconds to the millisecond", () => {
  assert.equal(fmtDelta(412), "+0.412");
  assert.equal(fmtDelta(0), "+0.000");
  assert.equal(fmtDelta(63_120), "+63.120", "a kart that stopped still reads as seconds lost");
});

test("a lone driver's laps are on screen without a click", () => {
  assert.equal(isExpanded("A1", {}, 1), true);
  assert.equal(isExpanded("A1", {}, 4), false, "a full grid stays one line per driver");
});

test("what the operator clicked outranks the default, both ways", () => {
  assert.equal(isExpanded("A1", { A1: false }, 1), false, "the lone driver can be folded away");
  assert.equal(isExpanded("A1", { A1: true }, 8), true);
  assert.equal(isExpanded("B2", { A1: true }, 8), false, "drivers open one at a time");
  assert.equal(isExpanded("C3", { A1: true, C3: true }, 8), true, "several can be open at once");
});
