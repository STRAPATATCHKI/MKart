// MegaKart's ranking rule, applied on every screen: the best lap wins, the number of laps does
// not count (decided 2026-09-24). The rule itself lives in lib/ranking-rules.mjs, shared with
// the day report and the MegaKart API; this is its typed door for the dashboard.

import * as rules from "./ranking-rules.mjs";

type Ranked = { bestLapMs?: number | null; grid?: number | null; laps?: number | null };

/**
 * Fastest best lap first; on an equal best lap, more laps first. Drivers without a lap yet sit
 * behind everyone who has one, in grid order - there is nothing to rank them on until they lap.
 */
export function byBestLap<T extends Ranked>(drivers: readonly T[]): T[] {
  return rules.byBestLap(drivers) as T[];
}
