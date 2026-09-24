// The start gantry, as data rather than as timers.
//
// The screen releases the pilots and the chrono with one action, so the parts that decide
// WHEN the lights change, WHETHER a start is allowed and WHAT the race clock reads are kept
// here as plain functions. The component only schedules them.

import type { TimingRace, TimingRaceState } from "@/lib/timing-client";

export const LIGHT_COUNT = 5;
const FIRST_LIGHT_MS = 700;
const LIGHT_GAP_MS = 850;
const HOLD_MIN_MS = 600;
const HOLD_SPREAD_MS = 900;
export const GREEN_HOLD_MS = 2600;

export type LightStep = { at: number; lights: number; green: boolean };

/**
 * Five reds, one per beat, then the whole bar turns green.
 *
 * The hold before green is deliberately not fixed: a constant gap is learnable, and a pilot
 * who has learned it is jumping the start rather than reacting to it. `random` is injected so
 * a test can pin the schedule.
 */
export function startLightSchedule(random: () => number = Math.random): { steps: LightStep[]; greenAt: number } {
  const steps: LightStep[] = [];
  for (let i = 1; i <= LIGHT_COUNT; i++) {
    steps.push({ at: FIRST_LIGHT_MS + i * LIGHT_GAP_MS, lights: i, green: false });
  }
  const greenAt = FIRST_LIGHT_MS + LIGHT_COUNT * LIGHT_GAP_MS + HOLD_MIN_MS + random() * HOLD_SPREAD_MS;
  steps.push({ at: greenAt, lights: LIGHT_COUNT, green: true });
  steps.push({ at: greenAt + GREEN_HOLD_MS, lights: 0, green: false });
  return { steps, greenAt };
}

export type StartCheck = { ok: true } | { ok: false; reason: string };

/** Why a start would be refused, in the words the operator sees on the screen. */
export function canStart(online: boolean, state: TimingRaceState | undefined): StartCheck {
  if (!online) return { ok: false, reason: "MegaKart Timing Control ne répond pas." };
  if (state === "RUNNING") return { ok: false, reason: "La course est déjà lancée." };
  if (state !== "PREPARED") return { ok: false, reason: "Préparez d’abord la course depuis le dashboard." };
  return { ok: true };
}

export type RaceClock = { text: string; pending: boolean } | null;

/**
 * What the big "TEMPS RESTANT" reads.
 *
 * Null means "show the wall clock instead". A prepared race shows nothing yet: it is armed,
 * not running, and the chrono only starts on the first transponder crossing — a ticking clock
 * before that would be counting time nobody is racing.
 */
export function formatRaceClock(race: Pick<TimingRace, "state" | "remainingMs" | "clockStarted"> | null | undefined): RaceClock {
  if (!race || race.remainingMs == null) return null;
  if (race.state !== "RUNNING" && race.state !== "FINISHED") return null;
  if (race.state === "RUNNING" && race.clockStarted === false) return { text: "PRÊT", pending: true };
  const total = Math.max(0, race.remainingMs);
  const mins = Math.floor(total / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  return { text: `${mins}:${String(secs).padStart(2, "0")}`, pending: false };
}
