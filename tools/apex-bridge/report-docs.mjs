// What the venue's data looks like in Firebase, under /reports - built here, pushed by
// cloud-reports.mjs. Pure functions, no I/O, exercised by tests/cloud-reports.test.mjs.
//
// Written for an app that reads revenue and races: every payment, the totals per day, the
// recent reservations, every saved race lap by lap, and the race on track right now.
//
// What never leaves the PC: phone numbers, emails, signatures, birth dates, heights. Names do
// go - a race without its drivers, or a payment without its payer, is not much of a report -
// and the rules let only accounts listed under /staff read any of it.

import { dayFuel, fuelDayKey, liveFuelStock } from "../../lib/fuel-rules.mjs";

const PAID = new Set(["PAYEE", "EN_PISTE", "TERMINEE"]);
/** Reservations are sent for this many days; payments, day totals and races are kept for good. */
export const RESERVATION_DAYS = 30;

/** Local calendar day, YYYY-MM-DD: a sale at 23:30 belongs to today, not to tomorrow in UTC. */
export function dayKey(when) {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };
const methodOf = (m) => (m === "Espèces" ? "cash" : m === "Carte bancaire" ? "card" : "other");

/**
 * Payments, day totals and recent reservations from the desk's reservations and the bridge's
 * sign-ups (which carry the pack the client chose and the code the phone showed them).
 * An amount is exact when the cashier typed it at the till; before that existed it is
 * estimated from the pack, and flagged so; with neither it is null and counted as unknown.
 */
export function buildReports(reservations, signups, now = new Date()) {
  const bySignup = new Map();
  for (const s of signups || []) if (s && s.queueCode) bySignup.set(s.queueCode, s);
  const cutoff = now.getTime() - RESERVATION_DAYS * 86_400_000;
  const payments = {};
  const days = {};
  const recent = {};

  for (const r of reservations || []) {
    if (!r || !r.code) continue;
    const signup = bySignup.get(r.code);
    const pack = (r.packOverride && r.packOverride.label) || (signup && signup.packLabel) || null;
    const expected = r.packOverride && r.packOverride.total != null ? r.packOverride.total
      : signup && signup.packTotalMad != null ? signup.packTotalMad : null;
    const pilots = Array.isArray(r.pilots) ? r.pilots : [];
    const paid = PAID.has(r.status) && !!r.paidAt;
    const exact = typeof r.paidAmount === "number" && Number.isFinite(r.paidAmount);
    const amount = paid ? (exact ? r.paidAmount : expected) : null;

    const created = ms(r.createdAt);
    if (r.status !== "SUPPRIMEE" && r.status !== "ANNULEE" && created != null && created >= cutoff) {
      recent[r.code] = {
        code: r.code, clientCode: signup ? signup.code || null : null,
        status: r.status, day: dayKey(created), createdAt: created,
        contactName: r.contactName || "", channel: r.channel || null,
        pilots: pilots.length, pilotNames: pilots.map((p) => p.fullName).filter(Boolean),
        pack, expectedAmount: expected,
        paidAt: paid ? ms(r.paidAt) : null, paidAmount: amount,
        method: paid ? (exact && r.paidSplit ? "mixed" : methodOf(r.paymentMethod)) : null,
      };
    }

    if (!paid) continue;
    const day = dayKey(r.paidAt);
    if (!day) continue;
    // Paid two ways (part cash, part card): method "mixed", and each part in its own column.
    const split = exact && r.paidSplit && r.paidSplit.cash > 0 && r.paidSplit.card > 0 ? r.paidSplit : null;
    const method = split ? "mixed" : methodOf(r.paymentMethod);
    const cashPart = amount == null ? null : split ? split.cash : method === "cash" ? amount : 0;
    const cardPart = amount == null ? null : split ? split.card : method === "cash" ? 0 : amount;
    payments[r.code] = {
      code: r.code, day, paidAt: ms(r.paidAt),
      amount: amount ?? null, estimated: !exact && amount != null,
      method, methodLabel: split ? "Espèces + Carte bancaire" : r.paymentMethod || null,
      cash: cashPart, card: cardPart, by: r.paidBy || null,
      pack, pilots: pilots.length, contactName: r.contactName || "", channel: r.channel || null, status: r.status,
    };
    const d = days[day] || (days[day] = { day, total: 0, cash: 0, card: 0, count: 0, pilots: 0, estimated: 0, unknown: 0 });
    d.count += 1;
    d.pilots += pilots.length;
    if (amount == null) { d.unknown += 1; continue; }
    d.total += amount;
    d.cash += cashPart;
    d.card += cardPart;
    if (!exact) d.estimated += 1;
  }

  const todayKey = dayKey(now);
  const waiting = (reservations || []).filter((r) => r && (r.status === "EN_ATTENTE" || r.status === "AU_GUICHET") && dayKey(r.createdAt) === todayKey);
  const t = days[todayKey] || { total: 0, cash: 0, card: 0, count: 0, pilots: 0, estimated: 0, unknown: 0 };
  const today = {
    day: todayKey, total: t.total, cash: t.cash, card: t.card, payments: t.count, pilotsPaid: t.pilots,
    estimated: t.estimated, unknown: t.unknown,
    waiting: waiting.length, pilotsWaiting: waiting.reduce((n, r) => n + (Array.isArray(r.pilots) ? r.pilots.length : 0), 0),
  };
  return { payments, days, reservations: recent, today };
}

/** A race Timing Control saved: who drove, where they finished, every lap. Simulations are left out. */
export function isSimulated(race) {
  return /^\s*\[sim\]/i.test((race && race.name) || "");
}

export function raceDoc(race) {
  const t = (s) => (s == null ? null : Math.round(Number(s) * 1000));   // Timing Control saves seconds
  const racers = (race.racers || [])
    .map((r) => ({
      position: r.position ?? null, driver: r.driver || "", kart: r.kart ?? null, laps: r.laps || 0,
      bestLapMs: r.bestLapMs ?? null, lastLapMs: r.lastLapMs ?? null,
      lapTimesMs: Array.isArray(r.lapTimesMs) ? r.lapTimesMs : [],
    }))
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const best = racers.filter((r) => r.bestLapMs > 0).sort((a, b) => a.bestLapMs - b.bestLapMs)[0] || null;
  const when = t(race.finishedAt ?? race.startedAt ?? race.savedAt);
  return {
    raceId: race.raceId, name: race.name || null, state: race.state || null,
    day: when ? dayKey(when) : null,
    startedAt: t(race.startedAt), finishedAt: t(race.finishedAt), durationS: race.durationS ?? null,
    drivers: racers.length, winner: racers[0] ? racers[0].driver : null,
    bestLapMs: best ? best.bestLapMs : null, bestLapBy: best ? best.driver : null,
    racers,
  };
}

/**
 * The race on track now, as the app shows it live. Only the state when nothing is running.
 * lastPassingAt (when the kart last crossed the line, venue clock, epoch ms) and lastLapMs let
 * the app place each kart on the circuit between crossings, as the dashboard does: progress
 * = (now - lastPassingAt) / lastLapMs, capped just short of the line.
 */
export function liveDoc(race) {
  if (!race || !Array.isArray(race.drivers) || race.drivers.length === 0 || race.state === "IDLE") {
    return { state: (race && race.state) || "IDLE" };
  }
  return {
    state: race.state, raceId: race.raceId || null, name: race.raceName || null,
    startedAt: race.startedAt ? ms(race.startedAt) : null, remainingMs: race.remainingMs ?? null,
    durationMs: race.durationMs ?? (race.durationS != null ? race.durationS * 1000 : null),
    clockStarted: race.clockStarted !== false, rankMode: race.rankMode || "course",
    trackLengthM: race.trackLengthM ?? null,
    drivers: race.drivers
      .map((d) => ({
        position: d.position ?? null, grid: d.grid ?? null, driver: d.driver || "", kart: d.kart ?? null,
        color: d.color ?? null, laps: d.laps || 0,
        lastLapMs: d.lastLapMs ?? null, bestLapMs: d.bestLapMs ?? null,
        lastPassingAt: typeof d.lastPassingAt === "number" ? d.lastPassingAt : null,
        lapTimesMs: Array.isArray(d.lapTimesMs) ? d.lapTimesMs : [],
      }))
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99)),
  };
}

/** The drawn circuit, so the app can draw the same track the TV and the dashboard show. */
export const TRACK_WIDTH = 704;
export const TRACK_HEIGHT = 268;
const LEGACY_TRACK_WIDTH = 560;
// The dashboard's built-in circuit (lib/track.ts, defaultRoutePoints, start 13), drawn at the
// legacy width: what every screen shows until someone draws the real one and it is saved.
const DEFAULT_LAYOUT = {
  version: 1, start: 13, finish: 13,
  points: [
    { x: 73, y: 191 }, { x: 50, y: 135 }, { x: 76, y: 82 }, { x: 126, y: 70 },
    { x: 177, y: 104 }, { x: 224, y: 96 }, { x: 264, y: 45 }, { x: 319, y: 37 },
    { x: 369, y: 85 }, { x: 425, y: 92 }, { x: 488, y: 103 }, { x: 510, y: 160 },
    { x: 474, y: 205 }, { x: 408, y: 201 }, { x: 354, y: 178 }, { x: 301, y: 210 },
    { x: 246, y: 215 }, { x: 198, y: 181 }, { x: 150, y: 168 }, { x: 111, y: 201 },
  ],
};

export function trackDoc(layout) {
  if (!layout || !Array.isArray(layout.points) || layout.points.length < 3) layout = DEFAULT_LAYOUT;
  // Layouts drawn before version 2 were 560 wide; the dashboard stretches them the same way.
  const scale = layout.version === 2 ? 1 : TRACK_WIDTH / LEGACY_TRACK_WIDTH;
  const points = layout.points
    .filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y))
    .map((pt) => ({ x: Math.round(pt.x * scale * 10) / 10, y: Math.round(pt.y * 10) / 10 }));
  if (points.length < 3) return null;
  const clampIndex = (i) => (Number.isInteger(i) && i >= 0 && i < points.length ? i : 0);
  return { width: TRACK_WIDTH, height: TRACK_HEIGHT, points, start: clampIndex(layout.start), finish: clampIndex(layout.finish ?? layout.start) };
}

/**
 * The multi-path update that makes `prefix` in Firebase match `desired`, given what was pushed
 * last time (id -> fingerprint, or null when only the id is known). Unchanged documents are not
 * sent again; documents that no longer exist are removed (null).
 */
export function diffUpdates(prefix, desired, pushed) {
  const updates = {};
  const fingerprints = {};
  for (const [id, doc] of Object.entries(desired)) {
    const fp = JSON.stringify(doc);
    fingerprints[id] = fp;
    if (pushed.get(id) !== fp) updates[`${prefix}/${id}`] = doc;
  }
  for (const id of pushed.keys()) if (!(id in desired)) updates[`${prefix}/${id}`] = null;
  return { updates, fingerprints };
}

// ------------------------------------------------------------------------------ garage

const FUEL_DEFAULTS = { capacityL: 500, juniorLph: 2.4, gtLph: 10, reserveL: 75, juniorKartNumbers: [] };

/**
 * The Garage for the app: the fuel of the day (the morning reading, then every race and every
 * kart that went round outside a race since, at the JUNIOR or GT rate - lib/fuel-rules.mjs, the
 * same rules as the dashboard), and the spare parts (the shelf, what to reorder, what went on
 * which kart). `fuelFile` and `garageFile` are the desk's fuel.json and garage.json.
 */
export function garageDoc({ fuelFile, garageFile, races, stints, now = new Date() }) {
  const settings = { ...FUEL_DEFAULTS, ...((fuelFile && fuelFile.settings) || {}) };
  if (!Array.isArray(settings.juniorKartNumbers)) settings.juniorKartNumbers = [];
  const day = fuelDayKey(now.getTime());
  const fuel = dayFuel(races || [], stints || [], settings, day);
  const reading = ((fuelFile && fuelFile.days) || []).find((d) => d && d.date === day) || null;
  const { stockL, burnedL } = liveFuelStock(reading, fuel);
  const fuelToday = {
    day,
    readingL: reading ? reading.openingL : null, refillL: reading ? reading.refillL || 0 : 0,
    measuredAt: reading && reading.measuredAt ? Date.parse(reading.measuredAt) : null,
    stockL: reading ? stockL : null, burnedSinceReadingL: burnedL,
    capacityL: settings.capacityL, reserveL: settings.reserveL, low: reading ? stockL <= settings.reserveL : false,
    racesL: fuel.racesL, freeRunsL: fuel.freeL, totalL: fuel.totalL,
    races: fuel.races.map((r) => ({ raceId: r.raceId, name: r.name, at: r.at, minutes: r.minutes, juniorKarts: r.juniorKarts, gtKarts: r.gtKarts, litres: r.litres })),
    runs: fuel.runs.map((r) => ({ kart: r.kart, transponder: r.transponder, start: r.start, end: r.end, passes: r.passes, minutes: r.minutes, litres: r.litres })),
  };
  const fuelDay = { day, racesL: fuel.racesL, freeRunsL: fuel.freeL, totalL: fuel.totalL, races: fuel.races.length, runs: fuel.runs.length };

  let parts = null;
  if (garageFile && Array.isArray(garageFile.parts)) {
    const items = garageFile.parts.filter((x) => x && x.name).map((x) => ({
      id: x.id, name: x.name, category: x.category || "autre", fits: x.fits || "tous", unit: x.unit || "pièce",
      stock: Number(x.stock) || 0, minStock: Number(x.minStock) || 0, low: (Number(x.stock) || 0) <= (Number(x.minStock) || 0),
      unitPrice: x.unitPrice ?? null,
    }));
    parts = {
      items,
      toReorder: items.filter((x) => x.low).sort((a, b) => (a.stock - a.minStock) - (b.stock - b.minStock))
        .map((x) => ({ name: x.name, stock: x.stock, minStock: x.minStock, unit: x.unit })),
      moves: (garageFile.moves || []).slice(0, 100).filter((m) => m && m.qty).map((m) => ({
        at: Date.parse(m.at) || null, part: m.partName || "", qty: m.qty, kind: m.qty > 0 ? "entree" : "sortie",
        kart: m.kart ?? null, note: m.note || "", by: m.by || null,
      })),
      savedAt: garageFile.savedAt ? Date.parse(garageFile.savedAt) : null,
    };
  }
  return { fuelToday, fuelDay, parts };
}
