// MegaKart's ranking rule, applied on every screen: the best lap wins, the number of laps does
// not count (decided 2026-09-24). A pilot with one lap and the best time is first.
//
// Plain JavaScript so the same rule serves the dashboard (lib/best-lap-order.ts), the day report
// and the MegaKart API on Render. MegaKart Timing Control ranks the same way for every race it
// starts; the screens apply the rule themselves too, so a race started in the old "course" mode
// is still shown in the right order.

const best = (d) => (d.bestLapMs != null && d.bestLapMs > 0 ? d.bestLapMs : null);

/**
 * Fastest best lap first; on an equal best lap, more laps first. Drivers without a lap yet sit
 * behind everyone who has one, in grid order - there is nothing to rank them on until they lap.
 */
export function byBestLap(drivers) {
  return [...drivers].sort((a, b) => {
    const A = best(a);
    const B = best(b);
    if (A != null && B != null) return A - B || (b.laps ?? 0) - (a.laps ?? 0);
    if (A != null) return -1;
    if (B != null) return 1;
    return (a.grid ?? 999) - (b.grid ?? 999);
  });
}
