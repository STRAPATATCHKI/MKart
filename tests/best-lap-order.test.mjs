// MegaKart's ranking on every screen, run against the real lib/best-lap-order.ts: best lap
// wins, laps do not count, drivers without a lap wait behind in grid order.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/best-lap-order.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { byBestLap } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("SESSION 5 as it stood: the best lap leads, whatever the laps", () => {
  const field = [
    { driver: "YASSEN", laps: 5, bestLapMs: 27300, grid: 2 },
    { driver: "KHADIJA", laps: 4, bestLapMs: 27492, grid: 1 },
    { driver: "MAHMOUD", laps: 4, bestLapMs: 29730, grid: 3 },
    { driver: "HASNA", laps: 3, bestLapMs: 31687, grid: 4 },
    { driver: "HASNAE", laps: 3, bestLapMs: 31093, grid: 5 },
  ];
  assert.deepEqual(byBestLap(field).map((d) => d.driver), ["YASSEN", "KHADIJA", "MAHMOUD", "HASNAE", "HASNA"]);
});

test("one lap with the best time beats many slower laps", () => {
  const order = byBestLap([{ driver: "A", laps: 12, bestLapMs: 29000 }, { driver: "B", laps: 1, bestLapMs: 27000 }]);
  assert.equal(order[0].driver, "B");
});

test("no lap yet: behind everyone with one, in grid order", () => {
  const order = byBestLap([
    { driver: "NOLAP-2", laps: 0, bestLapMs: null, grid: 2 },
    { driver: "LAP", laps: 1, bestLapMs: 30000, grid: 3 },
    { driver: "NOLAP-1", laps: 0, bestLapMs: null, grid: 1 },
  ]);
  assert.deepEqual(order.map((d) => d.driver), ["LAP", "NOLAP-1", "NOLAP-2"]);
});
