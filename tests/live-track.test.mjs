// The live-track position maths: what the single checkpoint can and cannot tell us.
//
// The component's geometry is pure arithmetic, so it is reimplemented here exactly as the
// component does it and checked against a square circuit whose lengths are obvious by hand.
import { strict as assert } from "node:assert";
import test from "node:test";

// --- the same two functions as components/track/live-track.tsx ---------------------------
function measure(points, start) {
  const n = points.length;
  const ordered = points.map((_, i) => points[(start + i) % n]);
  const closed = [...ordered, ordered[0]];
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < closed.length; i++) {
    total += Math.hypot(closed[i].x - closed[i - 1].x, closed[i].y - closed[i - 1].y);
    lengths.push(total);
  }
  return { lengths, total, ordered: closed };
}

function pointAt(fraction, table) {
  const { lengths, total, ordered } = table;
  if (total === 0) return { x: ordered[0].x, y: ordered[0].y, angle: 0 };
  const target = ((((fraction % 1) + 1) % 1)) * total;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < target) i++;
  const segment = lengths[i] - lengths[i - 1] || 1;
  const t = (target - lengths[i - 1]) / segment;
  const a = ordered[i - 1];
  const b = ordered[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
           angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
}

const HOLD = 0.03;
const TYPICAL = 35_000;

/** The field's average lap - what a kart with no lap of its own is assumed to be doing. */
function referenceLap(drivers, typical = TYPICAL) {
  const known = drivers.map((d) => d.lastLapMs).filter((v) => v != null && v > 0);
  if (!known.length) return typical;
  return known.reduce((a, b) => a + b, 0) / known.length;
}

function fractionFor(driver, now, running, reference = TYPICAL) {
  if (driver.lastPassingAt != null && running) {
    const pace = driver.lastLapMs != null && driver.lastLapMs > 0 ? driver.lastLapMs : reference;
    return Math.min((now - driver.lastPassingAt) / pace, 1 - HOLD);
  }
  if (driver.grid != null) return 1 - HOLD - (driver.grid - 1) * 0.012;
  return 0;
}

// A 400-unit square: each side is 100, so fractions land on round numbers.
const SQUARE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

test("fraction 0 is the start/finish marker, wherever it sits on the route", () => {
  for (const start of [0, 1, 2, 3]) {
    const at = pointAt(0, measure(SQUARE, start));
    assert.deepEqual({ x: at.x, y: at.y }, SQUARE[start], `start index ${start}`);
  }
});

test("a quarter of the way round is a quarter of the total length", () => {
  const table = measure(SQUARE, 0);
  assert.equal(table.total, 400);
  const at = pointAt(0.25, table);
  assert.equal(Math.round(at.x), 100);
  assert.equal(Math.round(at.y), 0);
});

test("a full lap returns to the line, and laps beyond 1 wrap", () => {
  const table = measure(SQUARE, 0);
  const once = pointAt(1, table);
  const thrice = pointAt(3, table);
  assert.deepEqual([Math.round(once.x), Math.round(once.y)], [0, 0]);
  assert.deepEqual([Math.round(thrice.x), Math.round(thrice.y)], [0, 0]);
});

test("mid-lap position is interpolated from the last lap time", () => {
  const crossed = 1_000_000;
  const driver = { lastPassingAt: crossed, lastLapMs: 30_000, laps: 3 };
  assert.equal(fractionFor(driver, crossed, true), 0, "at the line on crossing");
  assert.equal(fractionFor(driver, crossed + 15_000, true), 0.5, "half a lap after 15s of a 30s lap");
  assert.equal(fractionFor(driver, crossed + 22_500, true), 0.75);
});

test("the estimate never completes a lap the loop has not confirmed", () => {
  const driver = { lastPassingAt: 0, lastLapMs: 30_000 };
  // Way past the expected lap time - a slow lap - but it waits just short of the line.
  assert.equal(fractionFor(driver, 60_000, true), 1 - HOLD);
  assert.equal(fractionFor(driver, 600_000, true), 1 - HOLD, "still waiting, never wrapping");
});

test("a real crossing snaps the kart back to the line", () => {
  const table = measure(SQUARE, 0);
  const before = { lastPassingAt: 0, lastLapMs: 30_000 };
  const nearLine = pointAt(fractionFor(before, 29_000, true), table);
  assert.ok(fractionFor(before, 29_000, true) > 0.9, "almost round");
  // The loop reports a crossing: lastPassingAt becomes now, so the fraction is 0 again.
  const after = { lastPassingAt: 29_500, lastLapMs: 29_500 };
  const atLine = pointAt(fractionFor(after, 29_500, true), table);
  assert.deepEqual([Math.round(atLine.x), Math.round(atLine.y)], [0, 0]);
  assert.notDeepEqual([Math.round(nearLine.x), Math.round(nearLine.y)], [0, 0]);
});

test("before the start, karts sit on the grid in grid order behind the line", () => {
  const p1 = fractionFor({ grid: 1 }, 0, false);
  const p2 = fractionFor({ grid: 2 }, 0, false);
  const p3 = fractionFor({ grid: 3 }, 0, false);
  assert.ok(p1 > p2 && p2 > p3, "P1 is closest to the line");
  assert.ok(p1 < 1, "and nobody is past it");
});

test("a kart that has crossed once but has no lap time still moves", () => {
  const driver = { lastPassingAt: 0 };   // reference lap: no lastLapMs yet
  assert.equal(fractionFor(driver, 0, true), 0);
  assert.ok(fractionFor(driver, 10_000, true) > 0, "creeps away from the line");
});

test("with one detector, a kart's own last lap sets its pace", () => {
  const quick = { lastPassingAt: 0, lastLapMs: 20_000 };
  const slow = { lastPassingAt: 0, lastLapMs: 40_000 };
  // After 10s the quick kart is half way round; the slow one a quarter.
  assert.equal(fractionFor(quick, 10_000, true), 0.5);
  assert.equal(fractionFor(slow, 10_000, true), 0.25);
});

test("a kart with no lap yet borrows the field's average, not a guess", () => {
  const field = [
    { lastPassingAt: 0, lastLapMs: 30_000 },
    { lastPassingAt: 0, lastLapMs: 34_000 },
    { lastPassingAt: 0 },                       // just crossed for the first time
  ];
  const reference = referenceLap(field);
  assert.equal(reference, 32_000, "average of the two real laps");
  assert.equal(fractionFor(field[2], 16_000, true, reference), 0.5,
    "the newcomer moves at the field's pace");
});

test("the field average ignores karts with no lap and falls back when nobody has lapped", () => {
  assert.equal(referenceLap([{ lastPassingAt: 0 }, { lastPassingAt: 0 }]), TYPICAL);
  assert.equal(referenceLap([]), TYPICAL);
  assert.equal(referenceLap([{ lastLapMs: 0 }, { lastLapMs: 28_000 }]), 28_000,
    "a zero lap time is not evidence");
});

test("once its own lap is known, a kart stops borrowing the average", () => {
  const field = [{ lastPassingAt: 0, lastLapMs: 60_000 }];   // a very slow field
  const reference = referenceLap(field);
  const mine = { lastPassingAt: 0, lastLapMs: 20_000 };      // but I am quick
  assert.equal(fractionFor(mine, 10_000, true, reference), 0.5, "my own lap wins");
});

test("ordering on track follows laps, not just position round the circuit", () => {
  // Same fraction round the lap, different lap counts: more laps is ahead.
  const a = { laps: 5, lastPassingAt: 0, lastLapMs: 30_000 };
  const b = { laps: 4, lastPassingAt: 0, lastLapMs: 30_000 };
  const progress = (d) => d.laps + fractionFor(d, 15_000, true);
  assert.ok(progress(a) > progress(b));
});
