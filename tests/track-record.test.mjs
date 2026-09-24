// The track record, run against the real lib/track-record.ts: typed times, the comparison the
// TV makes, the floor that keeps hand-carried transponders from ever being a record, and the
// day's best that goes into each souvenir.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/track-record.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const T = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const record = { lapMs: 23_594, driver: "Mehdi", setAt: null };

test("the default record is the venue's 23.594", () => {
  assert.equal(T.DEFAULT_RECORD.lapMs, 23_594);
  assert.equal(T.fmtRecord(23_594), "23.594");
  assert.equal(T.fmtRecord(62_300), "1:02.300");
});

test("a typed lap time is read the ways people type it", () => {
  assert.equal(T.parseLap("23.594"), 23_594);
  assert.equal(T.parseLap("23,594"), 23_594);
  assert.equal(T.parseLap("0:23.594"), 23_594);
  assert.equal(T.parseLap("1:02.3"), 62_300);
  assert.equal(T.parseLap("abc"), null);
  assert.equal(T.parseLap("5"), null, "under 10 s is not a lap");
});

test("the TV compares the session's best with the record", () => {
  assert.deepEqual(T.compareToRecord(27_414, record), { kind: "behind", gapMs: 3_820 });
  assert.deepEqual(T.compareToRecord(23_400, record), { kind: "beaten", gainMs: 194 });
  assert.deepEqual(T.compareToRecord(null, record), { kind: "none" });
});

test("a lap far too fast to be real is never a record", () => {
  assert.deepEqual(T.compareToRecord(14_480, record), { kind: "none" }, "a transponder carried past the loop");
});

const t = (h) => new Date(2026, 8, 24, h, 0).getTime() / 1000;
const race = (name, when, racers) => ({ raceId: name, name, state: "FINISHED", startedAt: when, finishedAt: when, savedAt: when, durationS: 480, racers });
const racer = (driver, bestLapMs, kart = 3) => ({ driver, kart, transponder: "T", position: 1, laps: 5, lastLapMs: bestLapMs, bestLapMs });

test("the day's best leaves out other days, simulations and impossible laps", () => {
  const races = [
    race("today", t(16), [racer("Mehdi", 24_199), racer("Test", 14_480)]),
    race("[SIM] demo", t(17), [racer("Robot", 22_000)]),
    race("yesterday", t(16) - 86_400, [racer("Karim", 23_700)]),
  ];
  const best = T.dayBestLap(races, [{ driver: "Saad", bestLapMs: 27_414 }], record, new Date(2026, 8, 24, 20, 0));
  assert.deepEqual(best, { lapMs: 24_199, driver: "Mehdi" });
  const faster = T.dayBestLap(races, [{ driver: "Saad", bestLapMs: 24_000 }], record, new Date(2026, 8, 24, 20, 0));
  assert.deepEqual(faster, { lapMs: 24_000, driver: "Saad" }, "the race just finished counts");
});

test("only real laps faster than the record are offered for confirmation", () => {
  const races = [race("today", t(16), [racer("Saad", 23_400), racer("Test", 14_480), racer("Mehdi", 24_199)])];
  assert.deepEqual(T.recordCandidates(races, record).map((c) => [c.driver, c.lapMs]), [["Saad", 23_400]]);
});

test("a saved record is checked before it is trusted", () => {
  assert.deepEqual(T.normalizeRecord({ lapMs: 23594, driver: "  Mehdi ", setAt: "2026-09-24" }), { lapMs: 23594, driver: "Mehdi", setAt: "2026-09-24" });
  assert.equal(T.normalizeRecord({ lapMs: 5 }), null);
  assert.equal(T.normalizeRecord(null), null);
});
