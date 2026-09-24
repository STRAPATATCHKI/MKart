// What the karts burn, from what the chrono saw. Plain JavaScript, shared word for word by the
// dashboard's Garage page (lib/fuel-store.ts) and the bridge, which sends it to the manager's
// app - so both always show the same litres.
//
//   a race      its real length x each kart that did at least one lap
//   a free run  a kart going round outside a race (tests, warm-ups): from its first pass to its
//               last, plus one lap - the lap before its first pass, which the loop cannot see
// JUNIOR karts burn at the junior rate, every other kart at the GT rate.

const isSim = (race) => /^\s*\[sim\]/i.test((race && race.name) || "");
const rate = (kart, settings) => ((settings.juniorKartNumbers || []).includes(Number(kart)) ? settings.juniorLph : settings.gtLph);
const round2 = (v) => Math.round(v * 100) / 100;

/** Local calendar day, YYYY-MM-DD. */
export function fuelDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One saved race (Timing Control's /api/races/<id>, times in seconds). */
export function raceFuel(race, settings) {
  if (!race || isSim(race)) return null;
  const seconds = race.startedAt != null && race.finishedAt != null && race.finishedAt > race.startedAt
    ? race.finishedAt - race.startedAt
    : race.durationS ?? 0;
  if (!(seconds > 0)) return null;
  const junior = new Set(settings.juniorKartNumbers || []);
  let juniorKarts = 0;
  let gtKarts = 0;
  let lph = 0;
  for (const r of race.racers || []) {
    if (!(r.laps > 0)) continue;
    if (junior.has(Number(r.kart))) { juniorKarts += 1; lph += settings.juniorLph; } else { gtKarts += 1; lph += settings.gtLph; }
  }
  return {
    raceId: race.raceId, name: race.name ?? race.raceId,
    at: (race.finishedAt ?? race.startedAt ?? race.savedAt ?? 0) * 1000,
    minutes: Math.round((seconds / 60) * 10) / 10,
    juniorKarts, gtKarts,
    litres: round2(lph * (seconds / 3600)),
  };
}

/** One free run (Timing Control's /api/activity, times in seconds). A single pass is not a run. */
export function stintFuel(stint, settings) {
  if (!stint || !(stint.passes >= 2) || !(stint.end > stint.start)) return null;
  const span = stint.end - stint.start;
  const seconds = span + span / (stint.passes - 1);
  const junior = (settings.juniorKartNumbers || []).includes(Number(stint.kart));
  return {
    transponder: stint.transponder, kart: stint.kart ?? null,
    start: stint.start * 1000, end: stint.end * 1000, passes: stint.passes,
    minutes: Math.round((seconds / 60) * 10) / 10, junior,
    litres: round2(rate(stint.kart, settings) * (seconds / 3600)),
  };
}

/** Everything burned on one local day: races (newest first) and free runs (newest first). */
export function dayFuel(races, stints, settings, day) {
  const raceRows = (races || []).map((r) => raceFuel(r, settings))
    .filter((r) => r && fuelDayKey(r.at) === day).sort((a, b) => b.at - a.at);
  const runRows = (stints || []).map((s) => stintFuel(s, settings))
    .filter((s) => s && fuelDayKey(s.start) === day).sort((a, b) => b.start - a.start);
  const racesL = round2(raceRows.reduce((n, r) => n + r.litres, 0));
  const freeL = round2(runRows.reduce((n, r) => n + r.litres, 0));
  return { day, races: raceRows, runs: runRows, racesL, freeL, totalL: round2(racesL + freeL) };
}

/**
 * Fuel left now: the morning reading plus top-ups, minus every race and free run since the
 * reading was taken (anything before it is already in the barrel's level).
 */
export function liveFuelStock(reading, fuel) {
  if (!reading) return { stockL: 0, burnedL: 0 };
  const since = reading.measuredAt ? Date.parse(reading.measuredAt) : 0;
  const burnedL = round2(fuel.races.filter((r) => r.at >= since).reduce((n, r) => n + r.litres, 0)
    + fuel.runs.filter((r) => r.start >= since).reduce((n, r) => n + r.litres, 0));
  return { stockL: Math.max(0, round2(reading.openingL + (reading.refillL || 0) - burnedL)), burnedL };
}
