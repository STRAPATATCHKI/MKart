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

// ------------------------------------------------------------------------------ the barrel
//
// One running stock, never reset by the calendar: the level known for sure at a moment (the
// barrel full, 500 L, on day one - or a later fill or measurement), plus every litre poured in
// since, minus every race and free run since. The desk keeps it as `tank` in fuel.json:
//   { baseL, baseAt (ISO), refills: [{ at (ISO), litres }] }

/** Local midnight of a YYYY-MM-DD day, as ISO. */
const dayStart = (day) => new Date(`${day}T00:00:00`).toISOString();

/**
 * The barrel's running stock from a fuel file. Before it existed, each day had its own reading:
 * the count then starts on the first day of the log, the barrel full (day one), and the top-ups
 * typed since are kept. Null only with no log at all.
 */
export function tankFrom(state, capacityL = 500) {
  const t = state && state.tank;
  if (t && Number.isFinite(t.baseL) && typeof t.baseAt === "string" && !Number.isNaN(Date.parse(t.baseAt))) {
    return { baseL: t.baseL, baseAt: t.baseAt, refills: Array.isArray(t.refills) ? t.refills.filter((r) => r && r.litres > 0 && !Number.isNaN(Date.parse(r.at))) : [] };
  }
  const days = ((state && state.days) || []).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) return null;
  return {
    baseL: capacityL,
    baseAt: dayStart(days[0].date),
    refills: days.filter((d) => d.refillL > 0).map((d) => ({ at: d.measuredAt || new Date(`${d.date}T12:00:00`).toISOString(), litres: d.refillL })),
  };
}

/**
 * Fuel left now, from the running stock: every race (by its end) and free run (by its start)
 * since the known level is taken off. Can go under zero when a top-up was never entered - the
 * page says so rather than hiding it.
 */
export function tankStock(tank, races, stints, settings) {
  if (!tank) return null;
  const since = Date.parse(tank.baseAt);
  const raceRows = (races || []).map((r) => raceFuel(r, settings)).filter((r) => r && r.at >= since);
  const runRows = (stints || []).map((s) => stintFuel(s, settings)).filter((s) => s && s.start >= since);
  const burnedL = round2(raceRows.reduce((n, r) => n + r.litres, 0) + runRows.reduce((n, r) => n + r.litres, 0));
  const refillL = round2((tank.refills || []).filter((r) => Date.parse(r.at) >= since).reduce((n, r) => n + r.litres, 0));
  return { stockL: round2(tank.baseL + refillL - burnedL), baseL: tank.baseL, since, refillL, burnedL, races: raceRows.length, runs: runRows.length };
}

/** Top up: the litres poured in now. */
export const withRefill = (tank, litres, at = new Date()) => ({ ...tank, refills: [...(tank.refills || []), { at: at.toISOString(), litres }] });

/** Filled, or measured: the count starts again from this level, now. */
export const withLevel = (litresNow, at = new Date()) => ({ baseL: litresNow, baseAt: at.toISOString(), refills: [] });

/**
 * What a stock of fuel means - the barrel's level (what the drawing shows), the whole fleet's
 * burn per hour, and how long the stock lasts: the dashboard's "Autonomie", and the app's.
 */
export function fuelEstimate(stockL, settings) {
  const hours = settings.sessionMinutes / 60;
  const fleetLph = settings.juniorKarts * settings.juniorLph + settings.gtKarts * settings.gtLph;
  const fleetPerSessionL = fleetLph * hours;
  return {
    stockL,
    level: settings.capacityL > 0 ? Math.min(1, Math.max(0, stockL / settings.capacityL)) : 0,
    fleetLph,
    juniorPerSessionL: settings.juniorLph * hours,
    gtPerSessionL: settings.gtLph * hours,
    fleetPerSessionL,
    hoursLeft: fleetLph > 0 ? stockL / fleetLph : 0,
    sessionsLeft: fleetPerSessionL > 0 ? Math.floor(stockL / fleetPerSessionL) : 0,
    low: stockL <= settings.reserveL,
  };
}

export function liveFuelStock(reading, fuel) {
  if (!reading) return { stockL: 0, burnedL: 0 };
  const since = reading.measuredAt ? Date.parse(reading.measuredAt) : 0;
  const burnedL = round2(fuel.races.filter((r) => r.at >= since).reduce((n, r) => n + r.litres, 0)
    + fuel.runs.filter((r) => r.start >= since).reduce((n, r) => n + r.litres, 0));
  return { stockL: Math.max(0, round2(reading.openingL + (reading.refillL || 0) - burnedL)), burnedL };
}
