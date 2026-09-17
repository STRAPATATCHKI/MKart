import { souvenirGap, type RaceSouvenir } from "@/lib/race-souvenir";
import { fmtLap, type BoardRow } from "./race-simulation";

/** Leaderboard rows for an official (archived) classification, e.g. to drive the podium. */
export function rowsFromSouvenir(race: RaceSouvenir): BoardRow[] {
  const winner = race.drivers[0];
  return race.drivers.map((d, i) => ({
    id: `${d.kart}-${i}`,
    rank: i + 1,
    name: d.name,
    kart: d.kart,
    laps: d.laps,
    last: "—",
    best: fmtLap(d.bestLapMs),
    bestMs: d.bestLapMs,
    gap: i === 0 ? "LEADER" : souvenirGap(d, winner) ?? "—",
    total: d.totalTimeMs != null ? fmtLap(d.totalTimeMs) : "—",
    finished: true,
    lapProgress: 1,
    pilot: d.pilot ?? null,
  }));
}
