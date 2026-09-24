// The "Courses terminées" list, as arithmetic instead of JSX: which saved race is the newest,
// what its one-line summary says, and in what order its drivers finished.
//
// Every function here is deliberately defensive. These rows come out of Timing Control's own
// store (data\races\*.json and data\results.sqlite), written by whatever build was installed the
// day the race ran: a race saved before the lap-detail build carries no lapTimesMs, a race
// abandoned before the start carries no startedAt, and the owner must still get a readable line
// rather than "undefined" for the parts that are there.

import type { TimingSavedRacer } from "@/lib/timing-client";

/** What a summary needs of a saved race — satisfied by a list row and by a full race alike. */
export type SummarySource = {
  raceId?: string | null;
  name?: string | null;
  /** The chrono saves a race that was merely RUNNING when it was closed; it is not a result. */
  state?: string | null;
  startedAt?: number | string | null;
  finishedAt?: number | string | null;
  savedAt?: number | string | null;
  durationS?: number | null;
  racers?: number | readonly unknown[] | null;
};

export type RaceSummary = {
  raceId: string;
  /** The race name as the operator typed it, with the [SIM] tag lifted out into `simulated`. */
  title: string;
  simulated: boolean;
  /** When the race ended, for sorting — seconds since the epoch, the form the chrono saves. */
  endedAt: number | null;
  when: string;
  duration: string;
  /** False when `duration` is the duration that was *planned*, the race not having been timed. */
  measured: boolean;
  /** True only for a race the chrono actually finished. Anything else is a partial record. */
  finished: boolean;
  racers: number;
};

/** A simulated race is tagged in its name by Timing Control, and nowhere else in the payload. */
const SIM_TAG = /^\s*\[sim\]\s*/i;

export function isSimulated(name: string | null | undefined): boolean {
  return typeof name === "string" && SIM_TAG.test(name);
}

/**
 * Seconds since the epoch, whatever the field held.
 *
 * The saved files use epoch seconds while the live race frame types the same fields as ISO
 * strings, so both forms reach this module; and a value large enough to be milliseconds is
 * treated as such, because handing milliseconds to a seconds-based reader dates every race to
 * 1970 — a wrong date is worse than no date, the operator would sort by it.
 */
export function toEpochSeconds(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value > 1e11 ? value / 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed / 1000;
  }
  return null;
}

/**
 * Day and hour, as "22/09 14:37".
 *
 * Built from the parts rather than from toLocaleString: the same string must come out on the
 * desk PC, on a phone and in the tests, and the dd/mm form is the one the rest of the dashboard
 * already prints.
 */
export function fmtWhen(value: number | string | null | undefined): string {
  const epoch = toEpochSeconds(value);
  if (epoch == null) return "—";
  const d = new Date(epoch * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A span of time on the clock, "0:56" or "15:00" — the form the race deck's timer uses. */
export function fmtSpan(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const t = Math.round(seconds);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** The name to print: the [SIM] tag becomes a badge, and a nameless race falls back to its id. */
export function raceTitle(row: SummarySource): string {
  const name = typeof row.name === "string" ? row.name.replace(SIM_TAG, "").trim() : "";
  return name || (typeof row.raceId === "string" && row.raceId) || "Course sans nom";
}

/** However many pilots were on the sheet, whether the row counted them or listed them. */
export function racerCount(racers: SummarySource["racers"]): number {
  if (typeof racers === "number") return Number.isFinite(racers) ? racers : 0;
  return Array.isArray(racers) ? racers.length : 0;
}

/**
 * One saved race as its line in the list.
 *
 * The duration shown is the time the race actually took, not the slot it was booked for: a race
 * stopped after a minute of an eight-minute booking must not be listed as eight minutes. Only
 * when the race was never timed — no start, which happens when it is reset before the first
 * crossing — does the booked duration stand in, and `measured` then says so.
 */
export function raceSummary(row: SummarySource): RaceSummary {
  const started = toEpochSeconds(row.startedAt);
  const ended = toEpochSeconds(row.finishedAt) ?? toEpochSeconds(row.savedAt);
  const ran = started != null && ended != null && ended > started ? ended - started : null;
  const finished = String(row.state ?? "FINISHED").toUpperCase() === "FINISHED";
  return {
    raceId: typeof row.raceId === "string" ? row.raceId : "",
    title: raceTitle(row),
    simulated: isSimulated(row.name),
    endedAt: ended,
    when: fmtWhen(row.finishedAt ?? row.savedAt),
    duration: fmtSpan(ran ?? row.durationS),
    // A race the chrono never finished - it was still RUNNING when the app was closed - is a
    // partial record. Timing it from savedAt would present the moment of the crash as a finish
    // time, so the clock and the span are only ever called measured for a finished race.
    measured: finished && ran != null,
    finished,
    racers: racerCount(row.racers),
  };
}

/**
 * Every saved race, newest first.
 *
 * Sorted on the finishing time and never on the id: the chrono hands out ids per day and reuses
 * the counter across restarts, so today's list already holds 20260922-006 from before lunch and
 * 20260922-001 from after it. A race with no id at all is dropped rather than listed, since it
 * is the id the panel asks for the laps with.
 */
export function raceSummaries(rows: readonly SummarySource[] | null | undefined): RaceSummary[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(raceSummary)
    .filter((r) => r.raceId !== "")
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0) || b.raceId.localeCompare(a.raceId));
}

/**
 * The finishing order.
 *
 * The chrono's own positions lead, because they are what was announced at the desk. A driver
 * with no position — an entry the chrono never scored — goes to the bottom rather than to the
 * front, which is what an unguarded sort on null would do.
 */
export function classification(racers: readonly TimingSavedRacer[] | null | undefined): TimingSavedRacer[] {
  if (!Array.isArray(racers)) return [];
  const rank = (r: TimingSavedRacer) => (typeof r.position === "number" ? r.position : Number.MAX_SAFE_INTEGER);
  return [...racers].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.laps ?? 0) - (a.laps ?? 0) ||
      (a.bestLapMs ?? Number.POSITIVE_INFINITY) - (b.bestLapMs ?? Number.POSITIVE_INFINITY),
  );
}

/** The fastest lap of the whole race, which is the number people ask about after the podium. */
export function bestLap(racers: readonly TimingSavedRacer[] | null | undefined): { driver: string; ms: number } | null {
  let best: { driver: string; ms: number } | null = null;
  for (const r of Array.isArray(racers) ? racers : []) {
    if (typeof r.bestLapMs !== "number" || !Number.isFinite(r.bestLapMs)) continue;
    if (best === null || r.bestLapMs < best.ms) best = { driver: r.driver, ms: r.bestLapMs };
  }
  return best;
}

/** The plural the count needs, so the panel never prints "1 pilotes". */
export function pilotLabel(n: number): string {
  return `${n} pilote${n > 1 ? "s" : ""}`;
}
