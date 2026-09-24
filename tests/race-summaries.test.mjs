// The "Courses terminées" list: the order it comes out in, what each line says, and what it
// says about the rows Timing Control saved before it recorded everything it records today.
//
// Like lap-rows.test.mjs this imports the real module — Node 24 strips the type annotations on
// the way in — so there is no second copy of the rules to drift away from the shipped one.
//
// The payloads below are real rows from http://127.0.0.1:8795/api/races on the venue PC.
import { strict as assert } from "node:assert";
import test from "node:test";

import {
  bestLap, classification, fmtSpan, fmtWhen, isSimulated, pilotLabel,
  raceSummaries, raceSummary, raceTitle, racerCount, toEpochSeconds,
} from "../components/timing/race-summaries.ts";

/** The six races saved on the venue PC on 22/09, in the order the endpoint returned them. */
const SAVED = [
  { raceId: "20260922-002", name: "race3", state: "FINISHED", startedAt: 1790101030.62, finishedAt: 1790101086.34, durationS: 480, savedAt: 1790101143.29, racers: 1 },
  { raceId: "20260922-001", name: "Race 2", state: "FINISHED", startedAt: 1790100632.98, finishedAt: 1790100795.96, durationS: 480, savedAt: 1790100851.55, racers: 1 },
  { raceId: "20260922-006", name: "Race 2", state: "FINISHED", startedAt: 1790097658.60, finishedAt: 1790097778.75, durationS: 120, savedAt: 1790098453.80, racers: 1 },
  { raceId: "20260922-005", name: "Course", state: "FINISHED", startedAt: 1790097379.17, finishedAt: 1790097442.71, durationS: 480, savedAt: 1790097442.71, racers: 3 },
  { raceId: "20260922-004", name: "Race 8", state: "FINISHED", startedAt: null, finishedAt: 1790095567.98, durationS: 480, savedAt: 1790095567.98, racers: 1 },
  { raceId: "20260922-003", name: "[SIM] Demo piste", state: "FINISHED", startedAt: 1790094180.24, finishedAt: 1790095080.33, durationS: 900, savedAt: 1790095080.33, racers: 4 },
];

test("the newest race is at the top, whatever order the chrono answered in", () => {
  const shuffled = [SAVED[3], SAVED[5], SAVED[0], SAVED[4], SAVED[2], SAVED[1]];
  assert.deepEqual(
    raceSummaries(shuffled).map((r) => r.raceId),
    ["20260922-002", "20260922-001", "20260922-006", "20260922-005", "20260922-004", "20260922-003"],
  );
});

test("the order is the finishing time and never the id", () => {
  // 006 ran before 001 on the same day: the chrono's counter restarted, so sorting on the id
  // would put an afternoon race above an evening one.
  const order = raceSummaries(SAVED).map((r) => r.raceId);
  assert.ok(order.indexOf("20260922-001") < order.indexOf("20260922-006"), "001 finished after 006");
});

test("a race still being written falls back to when it was saved", () => {
  const rows = raceSummaries([
    { raceId: "B", name: "B", finishedAt: null, savedAt: 2_000, racers: 1 },
    { raceId: "A", name: "A", finishedAt: 3_000, savedAt: 3_000, racers: 1 },
  ]);
  assert.deepEqual(rows.map((r) => r.raceId), ["A", "B"]);
});

test("a race with no time at all is listed, at the bottom, and says so", () => {
  const rows = raceSummaries([{ raceId: "NOW", name: "x", finishedAt: 5_000, racers: 1 }, { raceId: "OLD", name: "y", racers: 1 }]);
  assert.deepEqual(rows.map((r) => r.raceId), ["NOW", "OLD"]);
  assert.equal(rows[1].when, "—", "no date is a dash, not Invalid Date");
  assert.equal(rows[1].duration, "—");
});

test("a row without an id is dropped: its laps could never be fetched", () => {
  assert.deepEqual(raceSummaries([{ name: "orpheline", finishedAt: 10 }]).map((r) => r.raceId), []);
});

test("nothing saved, or nothing answered, is an empty list rather than a crash", () => {
  assert.deepEqual(raceSummaries([]), []);
  assert.deepEqual(raceSummaries(null), []);
  assert.deepEqual(raceSummaries(undefined), []);
});

test("the line of a real race reads the way the owner would say it", () => {
  const r = raceSummary(SAVED[0]);
  assert.equal(r.title, "race3");
  assert.equal(r.racers, 1);
  assert.equal(r.simulated, false);
  assert.equal(r.duration, "0:56", "the race lasted 56 s of an 8 min booking");
  assert.equal(r.measured, true);
});

test("a race that was never started shows the booked slot, marked as such", () => {
  const r = raceSummary(SAVED[4]);
  assert.equal(r.duration, "8:00", "480 s booked");
  assert.equal(r.measured, false, "an unmeasured duration must be flagged, not printed as fact");
});

test("a finish before the start is not a negative duration", () => {
  const r = raceSummary({ raceId: "X", startedAt: 3_000, finishedAt: 2_000, durationS: 480 });
  assert.equal(r.measured, false);
  assert.equal(r.duration, "8:00");
});

test("simulated races are named as simulations and the tag leaves the title", () => {
  const sim = raceSummary(SAVED[5]);
  assert.equal(sim.simulated, true, "nobody must take a generated result for a real one");
  assert.equal(sim.title, "Demo piste", "the tag becomes a badge, so it is not printed twice");
  assert.equal(isSimulated("[sim] minuscules"), true);
  assert.equal(isSimulated("  [SIM] Demo"), true);
  assert.equal(isSimulated("Simulation"), false, "only the chrono's own tag counts");
  assert.equal(isSimulated(null), false);
});

test("a nameless race is still identifiable", () => {
  assert.equal(raceTitle({ raceId: "20260922-007", name: null }), "20260922-007");
  assert.equal(raceTitle({ raceId: "20260922-007", name: "   " }), "20260922-007");
  assert.equal(raceTitle({}), "Course sans nom");
});

test("the pilot count survives both shapes the chrono sends", () => {
  assert.equal(racerCount(3), 3, "the list endpoint counts them");
  assert.equal(racerCount([{ driver: "a" }, { driver: "b" }]), 2, "the detail endpoint lists them");
  assert.equal(racerCount(undefined), 0);
  assert.equal(racerCount(null), 0);
  assert.equal(pilotLabel(1), "1 pilote");
  assert.equal(pilotLabel(3), "3 pilotes");
  assert.equal(pilotLabel(0), "0 pilote");
});

test("the day and hour are read from epoch seconds, not milliseconds", () => {
  // Built from a local Date so the expectation holds wherever the tests run - the venue PC is
  // on Africa/Casablanca and CI is not.
  const d = new Date(2026, 8, 22, 14, 37, 12);
  const p = (n) => String(n).padStart(2, "0");
  assert.equal(fmtWhen(d.getTime() / 1000), `22/09 ${p(d.getHours())}:${p(d.getMinutes())}`);
  assert.equal(fmtWhen(d.getTime()), `22/09 ${p(d.getHours())}:${p(d.getMinutes())}`, "milliseconds must not land in 1970");
  assert.equal(fmtWhen(d.toISOString()), `22/09 ${p(d.getHours())}:${p(d.getMinutes())}`, "the live frame's ISO form");
  assert.equal(fmtWhen(null), "—");
  assert.equal(fmtWhen(undefined), "—");
  assert.equal(fmtWhen(0), "—", "the epoch itself is a missing date here, not midnight in 1970");
  assert.equal(fmtWhen("pas une date"), "—");
});

test("epoch seconds are told apart from epoch milliseconds", () => {
  assert.equal(toEpochSeconds(1790101086.34), 1790101086.34);
  assert.equal(toEpochSeconds(1790101086340), 1790101086.34);
  assert.equal(toEpochSeconds(-5), null);
  assert.equal(toEpochSeconds(Number.NaN), null);
});

test("durations read on the clock", () => {
  assert.equal(fmtSpan(55.72), "0:56");
  assert.equal(fmtSpan(480), "8:00");
  assert.equal(fmtSpan(900), "15:00");
  assert.equal(fmtSpan(0), "0:00", "a race of no length is still a length");
  assert.equal(fmtSpan(null), "—");
  assert.equal(fmtSpan(-1), "—");
});

test("the classification is the chrono's own order", () => {
  const racers = [
    { driver: "C", position: 3, laps: 2, bestLapMs: 20_000, transponder: "c" },
    { driver: "A", position: 1, laps: 3, bestLapMs: 14_480, transponder: "a" },
    { driver: "B", position: 2, laps: 3, bestLapMs: 15_000, transponder: "b" },
  ];
  assert.deepEqual(classification(racers).map((r) => r.driver), ["A", "B", "C"]);
});

test("a driver the chrono never scored sinks to the bottom, not to pole", () => {
  const racers = [
    { driver: "sans position", position: null, laps: 0, bestLapMs: null, transponder: "x" },
    { driver: "P1", position: 1, laps: 4, bestLapMs: 14_000, transponder: "a" },
  ];
  assert.deepEqual(classification(racers).map((r) => r.driver), ["P1", "sans position"]);
});

test("without positions the classification still reads laps then best lap", () => {
  const racers = [
    { driver: "lent", position: null, laps: 3, bestLapMs: 19_000, transponder: "a" },
    { driver: "rapide", position: null, laps: 3, bestLapMs: 15_000, transponder: "b" },
    { driver: "loin", position: null, laps: 5, bestLapMs: 21_000, transponder: "c" },
  ];
  assert.deepEqual(classification(racers).map((r) => r.driver), ["loin", "rapide", "lent"]);
});

test("a race nobody entered classifies nobody", () => {
  assert.deepEqual(classification([]), []);
  assert.deepEqual(classification(null), []);
  assert.deepEqual(classification(undefined), []);
});

test("the fastest lap of the race is found across the drivers", () => {
  const racers = [
    { driver: "A", bestLapMs: 14_480, laps: 3, position: 1, transponder: "a" },
    { driver: "B", bestLapMs: 13_900, laps: 3, position: 2, transponder: "b" },
  ];
  assert.deepEqual(bestLap(racers), { driver: "B", ms: 13_900 });
});

test("a race where nobody completed a lap has no fastest lap", () => {
  // 20260922-005: three pilots, one crossing each, not one of them a lap.
  const racers = [
    { driver: "Nadia Alami", position: 1, laps: 0, lastLapMs: null, bestLapMs: null, lapTimesMs: [], transponder: "ZKLBV93" },
    { driver: "Karim Benali", position: 2, laps: 0, lastLapMs: null, bestLapMs: null, lapTimesMs: [], transponder: "ZKLBV92" },
  ];
  assert.equal(bestLap(racers), null, "null, not NaN and not Infinity");
  assert.equal(classification(racers).length, 2, "they are still on the result sheet");
  assert.deepEqual(bestLap([]), null);
  assert.deepEqual(bestLap(undefined), null);
});
