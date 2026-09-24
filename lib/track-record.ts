// The track record: the fastest lap ever driven at MegaKart Fès, shown on the TV to give every
// pilot something to chase.
//
// It is an OFFICIAL value, set by the venue, not the minimum of the saved races: the history
// holds laps of 14 s from transponders carried past the loop by hand during tests, and the real
// record (23.594) predates this system. The desk keeps it (record.json); the Statistiques page
// edits it; the TV compares the session's best lap with it.
//
// Pure logic, exercised by tests/track-record.test.mjs.

import type { TimingSavedRace } from "@/lib/timing-client";

export type TrackRecord = { lapMs: number; driver: string | null; setAt: string | null };

/** The record as the venue gave it, used until one is saved on the desk. */
export const DEFAULT_RECORD: TrackRecord = { lapMs: 23_594, driver: null, setAt: null };

/**
 * A lap faster than this share of the record is not a kart going round this track - it is a
 * transponder carried past the loop, or a missed crossing. It is never announced as a record.
 */
export const RECORD_FLOOR = 0.9;

export const MIN_LAP_MS = 10_000;
export const MAX_LAP_MS = 600_000;

export function normalizeRecord(raw: unknown): TrackRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lapMs = Math.round(Number(r.lapMs));
  if (!Number.isFinite(lapMs) || lapMs < MIN_LAP_MS || lapMs > MAX_LAP_MS) return null;
  const driver = typeof r.driver === "string" && r.driver.trim() ? r.driver.trim().slice(0, 40) : null;
  const setAt = typeof r.setAt === "string" ? r.setAt : null;
  return { lapMs, driver, setAt };
}

/** "23.594", "23,594", "0:23.594" or "1:02.3" -> milliseconds; null when it is not a lap time. */
export function parseLap(text: string): number | null {
  const t = text.trim().replace(",", ".");
  const m = /^(?:(\d{1,2}):)?(\d{1,3}(?:\.\d{1,3})?)$/.exec(t);
  if (!m) return null;
  const ms = Math.round((Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000);
  return ms >= MIN_LAP_MS && ms <= MAX_LAP_MS ? ms : null;
}

/** 23594 -> "23.594"; 62300 -> "1:02.300". */
export function fmtRecord(ms: number): string {
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

export type RecordComparison =
  | { kind: "none" }                      // no lap yet, or only implausible ones
  | { kind: "behind"; gapMs: number }     // the session's best, this far from the record
  | { kind: "beaten"; gainMs: number };   // faster than the record, by this much

export function compareToRecord(bestMs: number | null | undefined, record: TrackRecord): RecordComparison {
  if (bestMs == null || !(bestMs > 0)) return { kind: "none" };
  if (bestMs < record.lapMs * RECORD_FLOOR) return { kind: "none" };
  if (bestMs < record.lapMs) return { kind: "beaten", gainMs: record.lapMs - bestMs };
  return { kind: "behind", gapMs: bestMs - record.lapMs };
}

export type RecordCandidate = { lapMs: number; driver: string; kart: number; raceName: string; at: number | null };

/** Saved laps that beat the record and are plausible: what the Statistiques page offers to confirm. */
export function recordCandidates(races: TimingSavedRace[], record: TrackRecord, limit = 3): RecordCandidate[] {
  const out: RecordCandidate[] = [];
  for (const race of races) {
    if (/^\s*\[sim\]/i.test(race.name ?? "")) continue;
    const t = race.finishedAt ?? race.startedAt ?? race.savedAt;
    for (const r of race.racers) {
      if (compareToRecord(r.bestLapMs, record).kind !== "beaten") continue;
      out.push({ lapMs: r.bestLapMs!, driver: r.driver, kart: r.kart, raceName: race.name ?? race.raceId, at: t != null ? t * 1000 : null });
    }
  }
  return out.sort((a, b) => a.lapMs - b.lapMs).slice(0, limit);
}

const localDay = (when: number) => {
  const d = new Date(when);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/**
 * The best lap of the day at the venue: every race saved today plus the one just finished.
 * Laps too fast to be real (under RECORD_FLOOR of the record) and simulations are left out, so a
 * transponder carried past the loop never becomes "the best of the day".
 */
export function dayBestLap(
  races: TimingSavedRace[],
  current: { driver: string; bestLapMs: number | null | undefined }[],
  record: TrackRecord,
  now = new Date(),
): { lapMs: number; driver: string } | null {
  const today = localDay(now.getTime());
  let best: { lapMs: number; driver: string } | null = null;
  const consider = (driver: string, ms: number | null | undefined) => {
    if (ms == null || !(ms > 0) || ms < record.lapMs * RECORD_FLOOR) return;
    if (!best || ms < best.lapMs) best = { lapMs: ms, driver };
  };
  for (const race of races) {
    if (/^\s*\[sim\]/i.test(race.name ?? "")) continue;
    const t = race.finishedAt ?? race.startedAt ?? race.savedAt;
    if (t == null || localDay(t * 1000) !== today) continue;
    for (const r of race.racers) consider(r.driver, r.bestLapMs);
  }
  for (const d of current) consider(d.driver, d.bestLapMs);
  return best;
}
