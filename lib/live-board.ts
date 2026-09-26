// "Course en direct": what the operator reads off the race on track, worked out from the live
// frame MegaKart Timing Control sends (GET /api/race/current). Plain functions, checked by
// tests/live-board.test.mjs without a browser.
//
//   order     best lap first, laps do not count (lib/best-lap-order.ts), as on every screen
//   gap       each driver's best lap against the leader's
//   stalled   a kart that has not crossed the line for far longer than its own lap: stopped on
//             track, in the pits, or a transponder that stopped answering - worth a look

import { byBestLap } from "@/lib/best-lap-order";
import type { TimingDriver, TimingRace } from "@/lib/timing-client";

export type BoardRow = {
  driver: TimingDriver;
  /** 1-based once the driver has a lap; null before. */
  position: number | null;
  /** Best lap minus the leader's best lap; 0 for the leader, null without a lap. */
  gapMs: number | null;
  /** Seconds since the kart last crossed the line; null when it has not crossed yet. */
  sincePassS: number | null;
  stalled: boolean;
  /** The lap just completed is the driver's best so far. */
  personalBest: boolean;
};

/** A kart is flagged after this long without a crossing, or 2.5 of its laps if longer. */
export const STALL_MIN_MS = 60_000;

export function liveBoard(drivers: readonly TimingDriver[], now: number, clockRunning: boolean): BoardRow[] {
  const ordered = byBestLap(drivers);
  const leader = ordered[0]?.bestLapMs ?? null;
  let n = 0;
  return ordered.map((d) => {
    const hasLap = d.bestLapMs != null && d.bestLapMs > 0;
    const since = d.lastPassingAt != null ? Math.max(0, now - d.lastPassingAt) : null;
    const pace = d.lastLapMs ?? d.bestLapMs ?? 35_000;
    return {
      driver: d,
      position: hasLap ? ++n : null,
      gapMs: hasLap && leader != null ? d.bestLapMs! - leader : null,
      sincePassS: since != null ? Math.floor(since / 1000) : null,
      stalled: clockRunning && since != null && since > Math.max(STALL_MIN_MS, pace * 2.5),
      personalBest: hasLap && (d.laps ?? 0) > 1 && d.lastLapMs === d.bestLapMs,
    };
  });
}

/** Share of the booked time already run, 0..1; null when the race has no duration or clock yet. */
export function raceProgress(race: Pick<TimingRace, "durationMs" | "durationS" | "remainingMs"> | null): number | null {
  if (!race || race.remainingMs == null) return null;
  const total = race.durationMs ?? (race.durationS != null ? race.durationS * 1000 : null);
  if (!total || total <= 0) return null;
  return Math.min(1, Math.max(0, 1 - race.remainingMs / total));
}

/** Average of a driver's laps, in ms; null without laps. */
export function averageLap(lapTimesMs: readonly number[] | undefined): number | null {
  if (!lapTimesMs || lapTimesMs.length === 0) return null;
  return Math.round(lapTimesMs.reduce((a, b) => a + b, 0) / lapTimesMs.length);
}

/** "+0.412", or "" for the leader. */
export const fmtGap = (ms: number | null) => (ms == null ? "—" : ms === 0 ? "" : `+${(ms / 1000).toFixed(3)}`);

/** "12 s", "2 min 05" - how long ago the kart crossed the line. */
export function fmtSince(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}
