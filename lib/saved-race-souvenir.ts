// A race MegaKart Timing Control saved, turned back into a podium - to show it again on the TV
// after the next race has started, from the TV's "Résultats" list or the dashboard's history.
//
// Ordered by MegaKart's rule (best lap wins, laps do not count), the same order the TV showed
// when the race ended; pilot colours come from the kart map saved with the race.

import { byBestLap } from "@/lib/best-lap-order";
import { MEGAKART_TRACK, type RaceSouvenir } from "@/lib/race-souvenir";
import type { TimingSavedRace } from "@/lib/timing-client";

export function souvenirFromSavedRace(race: TimingSavedRace): RaceSouvenir {
  const colorOf = (transponder: string) => race.kartMapping?.[transponder]?.color ?? null;
  const when = race.finishedAt ?? race.startedAt ?? race.savedAt;
  return {
    id: race.raceId,
    finishedAt: new Date(when != null ? when * 1000 : Date.now()).toISOString(),
    kind: /^\s*\[sim\]/i.test(race.name ?? "") ? "simulation" : "race",
    track: MEGAKART_TRACK,
    drivers: byBestLap(race.racers).map((r) => ({
      name: r.driver,
      kart: String(r.kart),
      laps: r.laps,
      bestLapMs: r.bestLapMs ?? null,
      totalTimeMs: null,
      pilot: colorOf(r.transponder),
    })),
  };
}
