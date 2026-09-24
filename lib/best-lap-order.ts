// MegaKart's ranking rule, applied on every screen: the best lap wins, the number of laps does
// not count (decided 2026-09-24). A pilot with one lap and the best time is first.
//
// MegaKart Timing Control ranks the same way for every race it starts from now on; the screens
// apply the rule themselves too, so a race started in the old "course" mode (by an older copy
// of the chrono, or a dashboard page not yet reloaded) is still shown in the right order.

type Ranked = { bestLapMs?: number | null; grid?: number | null; laps?: number | null };

const best = (d: Ranked) => (d.bestLapMs != null && d.bestLapMs > 0 ? d.bestLapMs : null);

/**
 * Fastest best lap first; on an equal best lap, more laps first. Drivers without a lap yet sit
 * behind everyone who has one, in grid order - there is nothing to rank them on until they lap.
 */
export function byBestLap<T extends Ranked>(drivers: readonly T[]): T[] {
  return [...drivers].sort((a, b) => {
    const A = best(a);
    const B = best(b);
    if (A != null && B != null) return A - B || (b.laps ?? 0) - (a.laps ?? 0);
    if (A != null) return -1;
    if (B != null) return 1;
    return (a.grid ?? 999) - (b.grid ?? 999);
  });
}
