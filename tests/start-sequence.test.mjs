// The big screen's start gantry: when the lights change, when a start is refused, and what
// the race clock reads.
//
// The module is TypeScript, so the three functions are reimplemented here exactly as
// components/big-screen/start-sequence.ts defines them — the same approach live-track.test.mjs
// takes. If that file's constants change, these fail, which is the point.
import { strict as assert } from "node:assert";
import test from "node:test";

const LIGHT_COUNT = 5;
const FIRST_LIGHT_MS = 700;
const LIGHT_GAP_MS = 850;
const HOLD_MIN_MS = 600;
const HOLD_SPREAD_MS = 900;
const GREEN_HOLD_MS = 2600;

function startLightSchedule(random = Math.random) {
  const steps = [];
  for (let i = 1; i <= LIGHT_COUNT; i++) steps.push({ at: FIRST_LIGHT_MS + i * LIGHT_GAP_MS, lights: i, green: false });
  const greenAt = FIRST_LIGHT_MS + LIGHT_COUNT * LIGHT_GAP_MS + HOLD_MIN_MS + random() * HOLD_SPREAD_MS;
  steps.push({ at: greenAt, lights: LIGHT_COUNT, green: true });
  steps.push({ at: greenAt + GREEN_HOLD_MS, lights: 0, green: false });
  return { steps, greenAt };
}

function canStart(online, state) {
  if (!online) return { ok: false, reason: "MegaKart Timing Control ne répond pas." };
  if (state === "RUNNING") return { ok: false, reason: "La course est déjà lancée." };
  if (state !== "PREPARED") return { ok: false, reason: "Préparez d’abord la course depuis le dashboard." };
  return { ok: true };
}

function formatRaceClock(race) {
  if (!race || race.remainingMs == null) return null;
  if (race.state !== "RUNNING" && race.state !== "FINISHED") return null;
  if (race.state === "RUNNING" && race.clockStarted === false) return { text: "PRÊT", pending: true };
  const total = Math.max(0, race.remainingMs);
  const mins = Math.floor(total / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  return { text: `${mins}:${String(secs).padStart(2, "0")}`, pending: false };
}

test("the reds light one at a time, then the bar turns green", () => {
  const { steps, greenAt } = startLightSchedule(() => 0.5);
  const reds = steps.filter((s) => !s.green && s.lights > 0);
  assert.equal(reds.length, LIGHT_COUNT);
  assert.deepEqual(reds.map((s) => s.lights), [1, 2, 3, 4, 5]);
  // strictly increasing, so no two lamps land on the same frame
  for (let i = 1; i < reds.length; i++) assert.ok(reds[i].at > reds[i - 1].at, "lights must be ordered");

  const green = steps.find((s) => s.green);
  assert.ok(green, "the gantry must turn green");
  assert.equal(green.lights, LIGHT_COUNT, "green lights the whole bar, it does not blank it");
  assert.ok(green.at > reds.at(-1).at, "green comes after the last red");
  assert.equal(green.at, greenAt);
});

test("green is held, then the gantry clears", () => {
  const { steps, greenAt } = startLightSchedule(() => 0);
  const last = steps.at(-1);
  assert.equal(last.lights, 0);
  assert.equal(last.green, false);
  assert.equal(last.at, greenAt + GREEN_HOLD_MS);
});

test("the hold before green is not a fixed, learnable gap", () => {
  const early = startLightSchedule(() => 0).greenAt;
  const late = startLightSchedule(() => 1).greenAt;
  assert.ok(late - early === HOLD_SPREAD_MS, "the whole spread must be reachable");
  assert.ok(early > FIRST_LIGHT_MS + LIGHT_COUNT * LIGHT_GAP_MS, "green never beats the fifth red");
});

test("a start is refused unless the chrono has a race prepared", () => {
  assert.equal(canStart(false, "PREPARED").ok, false, "offline chrono cannot start");
  assert.equal(canStart(true, "RUNNING").ok, false, "no double start");
  assert.equal(canStart(true, "IDLE").ok, false);
  assert.equal(canStart(true, "FINISHED").ok, false);
  assert.equal(canStart(true, undefined).ok, false);
  assert.equal(canStart(true, "PREPARED").ok, true);
});

test("each refusal says what to do about it", () => {
  assert.match(canStart(false, "IDLE").reason, /ne répond pas/);
  assert.match(canStart(true, "RUNNING").reason, /déjà lancée/);
  assert.match(canStart(true, "IDLE").reason, /Préparez/);
});

test("the clock shows the time left in the race", () => {
  assert.deepEqual(formatRaceClock({ state: "RUNNING", remainingMs: 8 * 60_000, clockStarted: true }),
                   { text: "8:00", pending: false });
  assert.deepEqual(formatRaceClock({ state: "RUNNING", remainingMs: 65_400, clockStarted: true }),
                   { text: "1:05", pending: false });
  assert.deepEqual(formatRaceClock({ state: "RUNNING", remainingMs: 9_000, clockStarted: true }),
                   { text: "0:09", pending: false }, "seconds are padded");
});

test("an armed race shows PRÊT, not a clock counting time nobody is racing", () => {
  const armed = formatRaceClock({ state: "RUNNING", remainingMs: 8 * 60_000, clockStarted: false });
  assert.equal(armed.text, "PRÊT");
  assert.equal(armed.pending, true);
});

test("the wall clock stays on screen when there is no race to time", () => {
  assert.equal(formatRaceClock(null), null);
  assert.equal(formatRaceClock({ state: "PREPARED", remainingMs: 480_000 }), null, "prepared is not running");
  assert.equal(formatRaceClock({ state: "IDLE", remainingMs: 480_000 }), null);
  assert.equal(formatRaceClock({ state: "RUNNING", remainingMs: null }), null);
});

test("a race that overran reads 0:00, never a negative clock", () => {
  assert.equal(formatRaceClock({ state: "FINISHED", remainingMs: -4200, clockStarted: true }).text, "0:00");
});

test("zero is a real remaining time, not a missing one", () => {
  // remainingMs === 0 is falsy: checking truthiness here would print the hour at the exact
  // moment the flag falls, which is when everyone is looking at it.
  assert.deepEqual(formatRaceClock({ state: "RUNNING", remainingMs: 0, clockStarted: true }),
                   { text: "0:00", pending: false });
});
