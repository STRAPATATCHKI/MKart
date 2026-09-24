// The lap list behind a driver row: every lap the driver has scored, not only the last one.
//
// Timing Control sends the whole lap array in the live frame, but the panel only ever showed
// DERNIER and MEILLEUR, which throws away three quarters of a four-lap race. The arithmetic -
// which lap is the driver's fastest, what each other lap gave away against it, and which rows a
// driver expands to - lives here as plain functions so it can be checked without a browser.

import type { TimingDriver } from "@/lib/timing-client";

/** What the lap list needs of a driver. An older Timing Control build sends neither field. */
export type LapSource = Pick<TimingDriver, "lapTimesMs" | "bestLapIndex">;

export type LapRow = {
  /** 1-based, the number the operator counts aloud; index 0 of the frame IS lap 1. */
  lap: number;
  ms: number;
  best: boolean;
  /** Time given away against this driver's own best lap, or null on the best lap itself. */
  delta: string | null;
};

/** mm:ss.mmm past the minute, plain seconds under it — the format the DERNIER column already uses. */
/**
 * Average speed over a lap, the way GoKarts shows it: circuit length / lap time.
 *
 * One detection loop cannot know how fast a kart is going at any instant, only when it passed,
 * so this is the only speed there is. Null when either figure is missing - a speed for a lap
 * of unknown length would be a number that means nothing.
 */
export function avgSpeedKmh(lapMs: number | null | undefined, trackLengthM: number | null | undefined): number | null {
  if (lapMs == null || !(lapMs > 0) || trackLengthM == null || !(trackLengthM > 0)) return null;
  return (trackLengthM / (lapMs / 1000)) * 3.6;
}

export function fmtSpeed(lapMs: number | null | undefined, trackLengthM: number | null | undefined): string {
  const kmh = avgSpeedKmh(lapMs, trackLengthM);
  return kmh == null ? "\u2014" : `${kmh.toFixed(1)} km/h`;
}

export function fmtLap(ms: number | null): string {
  if (ms == null) return "—";
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return m ? `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

/** Seconds given away, in the "+0.412" form every timing screen uses. */
export function fmtDelta(ms: number): string {
  return `+${(ms / 1000).toFixed(3)}`;
}

/**
 * The index of the driver's fastest lap.
 *
 * The frame's own bestLapIndex is used only when it agrees with the array it arrived with: a
 * stale or out-of-range index would colour a slower lap as the best one and turn every delta
 * negative, which reads as a broken screen. A tie goes to the earliest of the equal laps —
 * that driver set the time first — which is the rule the chrono derives its index with too, so
 * an index pointing at a later lap of the same time disagrees with the chrono, not with us.
 */
export function fastestLapIndex(laps: number[] | undefined, reported?: number | null): number | null {
  if (!laps || laps.length === 0) return null;
  let earliest = 0;
  for (let i = 1; i < laps.length; i++) if (laps[i] < laps[earliest]) earliest = i;
  if (reported != null && Number.isInteger(reported) && reported === earliest) return reported;
  return earliest;
}

/**
 * Every scored lap, in order, ready to render.
 *
 * The fastest lap carries no delta: against itself it is always +0.000, so printing it would
 * add a column of noise beside the lap already coloured as the best. That is also why a driver
 * on a single lap shows a time and nothing else — there is nothing yet to compare it to.
 */
export function lapRows(driver: LapSource): LapRow[] {
  const laps = driver.lapTimesMs;
  if (!laps || laps.length === 0) return [];
  const best = fastestLapIndex(laps, driver.bestLapIndex) ?? 0;
  return laps.map((ms, i) => ({
    lap: i + 1,
    ms,
    best: i === best,
    delta: i === best ? null : fmtDelta(ms - laps[best]),
  }));
}

/**
 * Whether this frame carries lap detail at all. An older Timing Control sends no lap array, and
 * the row must then stay exactly the line it has always been rather than offer an empty drawer.
 */
export function hasLapList(driver: LapSource): boolean {
  return Array.isArray(driver.lapTimesMs);
}

/**
 * Whether a driver's lap list is open.
 *
 * Nothing is remembered until the operator clicks a row, so a race with one driver — a pack
 * being tested, or a lone pilot — reads in full with no clicking at all, while a full grid
 * stays one scannable line per driver until someone asks for more.
 */
export function isExpanded(transponder: string, toggled: Record<string, boolean>, driverCount: number): boolean {
  const chosen = toggled[transponder];
  return chosen === undefined ? driverCount === 1 : chosen;
}
