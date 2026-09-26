// "Course en direct", run against the real lib/live-board.ts: the classement by best lap, the
// gap to the leader, and the kart flagged when it stops crossing the line.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});
after(async () => { await vite.close(); });
const B = await vite.ssrLoadModule("/lib/live-board.ts");

const NOW = 1_790_000_000_000;
const d = (driver, over = {}) => ({ driver, kart: 1, transponder: driver, laps: 0, lastLapMs: null, bestLapMs: null, position: null, ...over });

test("best lap first, laps do not count; no lap yet = no position", () => {
  const rows = B.liveBoard([
    d("Many laps", { laps: 12, bestLapMs: 24000, lastLapMs: 24500, lastPassingAt: NOW - 5000 }),
    d("One fast lap", { laps: 1, bestLapMs: 23100, lastLapMs: 23100, lastPassingAt: NOW - 3000 }),
    d("On the grid", { grid: 1 }),
  ], NOW, true);
  assert.deepEqual(rows.map((r) => r.driver.driver), ["One fast lap", "Many laps", "On the grid"]);
  assert.deepEqual(rows.map((r) => r.position), [1, 2, null]);
  assert.deepEqual(rows.map((r) => r.gapMs), [0, 900, null]);
  assert.equal(B.fmtGap(900), "+0.900");
});

test("a kart silent for far longer than its lap is flagged, only while the clock runs", () => {
  const karts = [
    d("Stopped", { laps: 4, bestLapMs: 24000, lastLapMs: 25000, lastPassingAt: NOW - 70_000 }),
    d("Slow but moving", { laps: 2, bestLapMs: 30000, lastLapMs: 30000, lastPassingAt: NOW - 50_000 }),
  ];
  const rows = B.liveBoard(karts, NOW, true);
  assert.equal(rows.find((r) => r.driver.driver === "Stopped").stalled, true);
  assert.equal(rows.find((r) => r.driver.driver === "Slow but moving").stalled, false, "under a minute is never flagged");
  assert.equal(B.liveBoard(karts, NOW, false).some((r) => r.stalled), false, "armed or finished: nothing is flagged");
  assert.equal(rows[0].sincePassS, 70);
  assert.equal(B.fmtSince(70), "1 min 10");
});

test("the lap just done is flagged when it is the driver's best", () => {
  const [row] = B.liveBoard([d("A", { laps: 5, bestLapMs: 23500, lastLapMs: 23500 })], NOW, true);
  assert.equal(row.personalBest, true);
  const [first] = B.liveBoard([d("B", { laps: 1, bestLapMs: 23500, lastLapMs: 23500 })], NOW, true);
  assert.equal(first.personalBest, false, "a first lap is not an improvement");
});

test("progress of the race and the average lap", () => {
  assert.equal(B.raceProgress({ durationMs: 600_000, remainingMs: 150_000 }), 0.75);
  assert.equal(B.raceProgress({ durationS: 480, remainingMs: 480_000 }), 0);
  assert.equal(B.raceProgress({ durationMs: null, durationS: null, remainingMs: 10 }), null);
  assert.equal(B.averageLap([23000, 24000, 25000]), 24000);
  assert.equal(B.averageLap([]), null);
});
