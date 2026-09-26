// Rapport du jour: every race of a day set against the till of that day, so a race nobody paid
// for stands out. Plain JavaScript, shared word for word by the dashboard (lib/day-report.ts,
// from the desk's own data) and the MegaKart API on Render (tools/megakart-api/api.mjs, from the
// /reports data in Firebase) - so the PDF the manager's app downloads says what the desk prints.
//
// How a pilot in a race is matched to a payment:
//   names      the chrono's name and the booking's are compared word by word, ignoring accents,
//              case, short particles (el, al, si) and one or two typing slips per word
//              ("Benmimoun" / "Benmimoum", "Simohamed Berrada" / "MOHAMMED BERRADA"). A first
//              name alone ("HAMZA") is never taken as a match: it is shown to check by hand.
//   allowance  how many races a payment covers per pilot: from its pack, or from the amount
//              when the amount is the exact price of a pack giving more races (120 DH = Session
//              8 min = 1 race; 210 DH = 16 min = 2 races...).
//   order      races are taken in time order; each one uses up one race of the pilot's payment.
//              Beyond it, the race is "en plus" - raced, not paid.
//
// Input, already narrowed to the day by the caller (which knows the venue's calendar):
//   races   [{ raceId, name, startedAt, finishedAt (ms), racers: [{ driver, kart, laps, bestLapMs, lapTimesMs, grid }] }]
//   till    [{ code, clientCode, status, paidAt (ms), paidOnDay, amount, method, pilots: [{ id, name }],
//              packId, packName, packPrice }]  - booked or cashed that day, never deleted or cancelled
//   offers  the catalog

import { offerTotal } from "./offer-rules.mjs";
import { byBestLap } from "./ranking-rules.mjs";

/** One race is an 8-minute session: a "Session 16 min" is two races. */
export const RACE_MINUTES = 8;
/** The venue's clock, for days and times computed on a server that runs on UTC. */
export const VENUE_TZ = "Africa/Casablanca";

const PAID = new Set(["PAYEE", "EN_PISTE", "TERMINEE"]);
const BOOKED = new Set(["EN_ATTENTE", "AU_GUICHET", "ABSENT"]);
export const isTestRace = (name) => /\btest\b|\[sim\]/i.test(name ?? "");

// ------------------------------------------------------------------------------------ names

const PARTICLES = new Set(["el", "al", "si", "de", "la", "le", "da", "du"]);

function fold(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

/** A name as comparable words: "Si Mohammed EL Berrada" -> ["mohamed", "berrada"]. */
export function nameTokens(name) {
  return fold(name).split(" ").filter((t) => t && !PARTICLES.has(t))
    .map((t) => (/^(si|sidi)?(moh?amm?[ae]d|mouhamm?ed|mhamm?ed)$/.test(t) ? "mohamed" : t));
}

function lev(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** Two words for the same name: equal, or one slip apart (two for long words). */
function sameWord(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 4) return false;
  return lev(a, b) <= (n >= 7 ? 2 : 1);
}

/** Every word of the shorter name finds its own word in the other; both need two words at least. */
export function sameName(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set();
  return short.every((w) => {
    const i = long.findIndex((x, k) => !used.has(k) && sameWord(w, x));
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}

/** Close but not sure: a first name alone found in the other name, or the same family name. */
function closeName(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.length === 1 || tb.length === 1) {
    const [one, other] = ta.length === 1 ? [ta[0], tb] : [tb[0], ta];
    return other.some((w) => sameWord(one, w));
  }
  // Two full names: only the same family name is worth a look (a shared first name is not).
  return sameWord(ta[ta.length - 1], tb[tb.length - 1]);
}

// ------------------------------------------------------------------------------------ packs

/** Races a pack gives each pilot; Infinity for a subscription, null when it does not say. */
export function racesInOffer(offer) {
  if (offer.period !== "unique") return Infinity;
  if (offer.unit === "sessions") return Math.max(1, (offer.quantity || 0) + (offer.bonus || 0));
  if (offer.unit === "minutes") return Math.max(1, Math.round((offer.quantity || 0) / RACE_MINUTES));
  return null;
}

/** The cheapest a pilot can race once, in the catalog: below it, a payment cannot be complete. */
export function cheapestRace(offers) {
  let best = null;
  for (const o of offers) {
    if (!o || o.enabled === false || o.period !== "unique") continue;
    const races = racesInOffer(o);
    if (!races || !Number.isFinite(races)) continue;
    const perPilot = o.basis === "groupe" ? o.price / Math.max(1, o.people ?? 1) : o.price;
    const perRace = perPilot / races;
    if (best == null || perRace < best) best = perRace;
  }
  return best;
}

function allowance(t, offers) {
  const pilots = Math.max(1, t.pilots.length);
  const amount = typeof t.amount === "number" ? t.amount : null;
  const on = offers.filter((o) => o && o.enabled !== false);
  // The pack: by id when the till knows it, else by the name it was sold under ("Silver",
  // "Pack Famille · forfait groupe").
  const byName = (name) => (name ? on.find((o) => o.name === name || String(name).startsWith(`${o.name} ·`)) ?? null : null);
  const chosen = (t.packId ? offers.find((o) => o && o.id === t.packId) : null) ?? byName(t.packName);
  // The pack the amount is exactly the price of: per pilot for a per-person offer, whole for a group one.
  const fit = amount != null && amount > 0
    ? on.find((o) => o.period === "unique" && o.basis !== "groupe" && o.price * pilots === amount)
      ?? on.find((o) => o.period === "unique" && o.basis === "groupe" && o.price === amount && pilots <= (o.people ?? pilots))
      ?? null
    : null;
  const label = t.packName ?? chosen?.name ?? fit?.name ?? null;
  const packPrice = typeof t.packPrice === "number" ? t.packPrice : chosen ? offerTotal(chosen, pilots) : null;
  const fromPack = chosen ? racesInOffer(chosen) : null;
  const fromAmount = fit ? racesInOffer(fit) : null;
  // Paid for more than the pack says (moved up to 16 min at the counter without changing the
  // pack): the money is what counts. Never fewer races than the pack chosen.
  if (fromAmount != null && (fromPack == null || fromAmount > fromPack)) {
    return { perPilot: fromAmount, from: `${fit.name} (d’après le montant)`, pack: label, packPrice };
  }
  if (fromPack != null) return { perPilot: fromPack, from: chosen.name, pack: label, packPrice };
  const cheapest = cheapestRace(offers);
  if (amount != null && amount > 0 && cheapest) {
    return { perPilot: Math.floor(amount / pilots / cheapest), from: `estimé : ${Math.round(amount / pilots)} DH par pilote`, pack: label, packPrice };
  }
  return { perPilot: null, from: "inconnu", pack: label, packPrice };
}

// ------------------------------------------------------------------------------------ report

/**
 * The races of one day and the till of that day, set against each other.
 * @param {{ day: string, races?: any[], till?: any[], offers?: any[] }} input
 */
export function buildDayReport({ day, races = [], till = [], offers = [] }) {
  const payments = till
    .filter((t) => PAID.has(t.status))
    .sort((a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0))
    .map((t) => {
      const a = allowance(t, offers);
      return {
        t, used: new Map(),
        code: t.code, clientCode: t.clientCode ?? null, status: t.status,
        paidAt: t.paidAt ?? null, paidOnDay: !!t.paidOnDay, amount: typeof t.amount === "number" ? t.amount : null, method: t.method ?? "",
        pack: a.pack, packPrice: a.packPrice, perPilot: a.perPilot, allowanceFrom: a.from,
        pilots: t.pilots.map((p) => ({ name: p.name, races: 0 })), racesDone: 0, racesCovered: 0, racesExtra: 0,
      };
    });
  const booked = till.filter((t) => BOOKED.has(t.status));

  const reportRaces = [...races]
    .sort((a, b) => (a.startedAt ?? a.finishedAt ?? 0) - (b.startedAt ?? b.finishedAt ?? 0))
    .map((race) => {
      const test = isTestRace(race.name);
      const at = race.startedAt ?? race.finishedAt ?? 0;
      let pos = 0;
      const entries = byBestLap(race.racers || []).map((d) => {
        const hasLap = d.bestLapMs != null && d.bestLapMs > 0;
        const entry = {
          raceId: race.raceId, raceName: String(race.name ?? "").trim() || race.raceId, at,
          position: hasLap ? ++pos : null, driver: d.driver, kart: d.kart ?? null, laps: d.laps ?? 0,
          bestLapMs: d.bestLapMs ?? null, lapTimesMs: Array.isArray(d.lapTimesMs) ? d.lapTimesMs : [],
          coverage: "none", reservation: null, suggestions: [],
        };
        if (test) return entry;
        // A payment of this pilot with a race left, earliest paid first; otherwise the last they paid.
        const mine = payments.filter((p) => p.t.pilots.some((x) => sameName(x.name, d.driver)));
        if (mine.length) {
          const pilotOf = (p) => p.t.pilots.find((x) => sameName(x.name, d.driver));
          const left = mine.find((p) => {
            const used = p.used.get(pilotOf(p).id) ?? 0;
            return p.perPilot == null ? used < 1 : used < p.perPilot;
          });
          const p = left ?? mine[mine.length - 1];
          const pilot = pilotOf(p);
          p.used.set(pilot.id, (p.used.get(pilot.id) ?? 0) + 1);
          p.pilots[p.t.pilots.indexOf(pilot)].races += 1;
          p.racesDone += 1;
          if (left) { p.racesCovered += 1; entry.coverage = "paid"; } else { p.racesExtra += 1; entry.coverage = "extra"; }
          entry.reservation = p.code;
          return entry;
        }
        const waiting = booked.find((t) => t.pilots.some((x) => sameName(x.name, d.driver)));
        if (waiting) { entry.coverage = "booked"; entry.reservation = waiting.code; return entry; }
        entry.suggestions = [...payments.map((p) => p.t), ...booked]
          .flatMap((t) => t.pilots.filter((x) => closeName(x.name, d.driver)).map((x) => `${x.name} · ${t.code}`))
          .slice(0, 3);
        entry.coverage = entry.suggestions.length ? "check" : "none";
        return entry;
      });
      return { raceId: race.raceId, name: String(race.name ?? "").trim() || race.raceId, startedAt: race.startedAt ?? null, finishedAt: race.finishedAt ?? null, test, entries };
    });

  const real = reportRaces.filter((r) => !r.test).flatMap((r) => r.entries);
  const count = (c) => real.filter((e) => e.coverage === c).length;
  const pilotNames = [];
  for (const e of real) if (!pilotNames.some((p) => p === e.driver || sameName(p, e.driver))) pilotNames.push(e.driver);
  const sessionOffer = offers.find((o) => o && o.enabled !== false && o.kind === "session" && o.unit === "minutes" && o.quantity === RACE_MINUTES && o.basis !== "groupe");
  const cheapest = cheapestRace(offers);
  const racePrice = sessionOffer?.price ?? (cheapest != null ? Math.round(cheapest) : null);
  const uncovered = real.filter((e) => e.coverage !== "paid");
  const clean = payments.map((p) => ({
    code: p.code, clientCode: p.clientCode, status: p.status, paidAt: p.paidAt, paidOnDay: p.paidOnDay, amount: p.amount, method: p.method,
    pack: p.pack, packPrice: p.packPrice, perPilot: p.perPilot, allowanceFrom: p.allowanceFrom, pilots: p.pilots,
    racesDone: p.racesDone, racesCovered: p.racesCovered, racesExtra: p.racesExtra,
  }));
  const short = clean.filter((p) => p.amount != null && p.packPrice != null && p.amount < p.packPrice);

  return {
    day,
    races: reportRaces,
    payments: clean,
    uncovered,
    paidNoRace: clean.filter((p) => p.racesDone === 0),
    totals: {
      races: reportRaces.filter((r) => !r.test).length,
      tests: reportRaces.filter((r) => r.test).length,
      driverRaces: real.length,
      pilots: pilotNames.length,
      covered: count("paid"),
      extra: count("extra"),
      booked: count("booked"),
      check: count("check"),
      none: count("none"),
      revenue: clean.filter((p) => p.paidOnDay).reduce((n, p) => n + (p.amount ?? 0), 0),
      racePrice,
      missingDh: racePrice != null ? uncovered.length * racePrice : null,
      underpaid: short.length,
      underpaidDh: short.reduce((n, p) => n + (p.packPrice - p.amount), 0),
    },
  };
}

// ------------------------------------------------------------------------------------ from Firebase

/** The venue's calendar day of a moment, whatever the clock of the machine asking. */
export function venueDay(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: VENUE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

const METHOD_FR = { cash: "Espèces", card: "Carte bancaire", mixed: "Espèces + Carte", other: "Autre" };

/**
 * The report's input from the /reports documents the venue PC pushes to Firebase (see
 * docs/firebase-reports.md): the day's races, and the reservations booked or cashed that day.
 */
/** @param {{ day: string, raceDocs?: any[], reservationDocs?: any[] }} input */
export function inputFromReports({ day, raceDocs = [], reservationDocs = [] }) {
  const races = raceDocs
    .filter((r) => r && r.day === day)
    .map((r) => ({
      raceId: r.raceId, name: r.name ?? null, startedAt: r.startedAt ?? null, finishedAt: r.finishedAt ?? null,
      racers: (r.racers || []).map((d) => ({ driver: d.driver, kart: d.kart ?? null, laps: d.laps ?? 0, bestLapMs: d.bestLapMs ?? null, lapTimesMs: d.lapTimesMs || [] })),
    }));
  const till = reservationDocs
    .filter((r) => r && r.code && r.status !== "SUPPRIMEE" && r.status !== "ANNULEE")
    .map((r) => ({ r, paidDay: r.paidAt ? venueDay(r.paidAt) : null }))
    .filter(({ r, paidDay }) => r.day === day || (PAID.has(r.status) && paidDay === day))
    .map(({ r, paidDay }) => ({
      code: r.code, clientCode: r.clientCode ?? null, status: r.status,
      paidAt: r.paidAt ?? null, paidOnDay: paidDay === day, amount: typeof r.paidAmount === "number" ? r.paidAmount : null,
      method: METHOD_FR[r.method] ?? r.method ?? "",
      pilots: (r.pilotNames || []).map((name, i) => ({ id: `${r.code}-${i}`, name })),
      packId: null, packName: r.pack ?? null, packPrice: typeof r.expectedAmount === "number" ? r.expectedAmount : null,
    }));
  return { races, till };
}
