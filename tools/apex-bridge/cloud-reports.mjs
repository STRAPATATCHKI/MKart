// Sends the venue's revenue and races to Firebase (/reports), for the manager's app.
//
//   every 30 s   payments, day totals, recent reservations, today's summary  <- the desk (/api/queue)
//                every race saved since the last round                        <- Timing Control (/api/races)
//                the circuit as drawn on the dashboard                        <- the desk (/api/track)
//                the Garage: today's fuel, spare parts                        <- the desk (/api/fuel,
//                                                                                /api/garage) and the chrono
//   every 2 s    the race on track, while one is prepared or running          <- Timing Control (/api/race/current)
//
// Only what changed is sent, in one multi-path update per round. Runs inside the bridge because
// the bridge already holds the service-account key and runs all day on this PC; a bridge that
// cannot reach the desk or the chrono (the one on Render) simply sends nothing.
//
// The documents themselves are built by report-docs.mjs; the rules (database.rules.json) let
// only accounts listed under /staff read them.

import fs from "node:fs";
import { cloudConfigured, cloudGet, cloudPatch, cloudPut } from "./cloud.mjs";
import { buildReports, diffUpdates, garageDoc, isSimulated, liveDoc, raceDoc, trackDoc } from "./report-docs.mjs";
import { fuelDayKey, tankFrom } from "../../lib/fuel-rules.mjs";
import { reportDoc as disbursementDoc } from "../../lib/disbursement-rules.mjs";

/** Every local day from `first` to `last` (YYYY-MM-DD), at most the last 120. */
function daysFrom(first, last) {
  const out = [];
  const d = new Date(`${first}T12:00:00`);
  while (out.length < 400) {
    const key = fuelDayKey(d.getTime());
    out.push(key);
    if (key >= last) break;
    d.setDate(d.getDate() + 1);
  }
  return out.slice(-120);
}

const DESK_EVERY_MS = 30_000;
const LIVE_EVERY_MS = 2_000;
const IDLE_LIVE_EVERY = 5;          // while nothing runs, look at the chrono every 5th tick (10 s)
// Proof of life for the app: /reports/meta is rewritten at least this often, even on a quiet
// night with nothing to send, so "PC en ligne" never depends on someone paying.
const HEARTBEAT_MS = 60_000;
const CHUNK = 400;                  // paths per update request

async function getJson(url, timeoutMs = 5000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function pushUpdates(updates) {
  const paths = Object.keys(updates);
  for (let i = 0; i < paths.length; i += CHUNK) {
    const part = {};
    for (const p of paths.slice(i, i + CHUNK)) part[p] = updates[p];
    await cloudPatch("reports", part);
  }
  return paths.length;
}

export function startReportSync({ deskUrl, timingUrl = "http://127.0.0.1:8795", readSignups, stateFile, log = console.log }) {
  if (!cloudConfigured()) {
    log("[rapports] pas de clé Firebase sur ce PC : revenus et courses ne sont pas envoyés");
    return;
  }

  const pushed = { payments: new Map(), days: new Map(), reservations: new Map() };
  // Races never change once saved; remember which were sent, across restarts, so a restart
  // does not download and re-send the whole season.
  let racesSent = {};
  // Décaissement photos never change either: each is sent once ("<request id>/<photo id>").
  let photosSent = new Set();
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    racesSent = state.races || {};
    photosSent = new Set(Array.isArray(state.photos) ? state.photos : []);
  } catch { /* first run */ }
  const saveState = () => { try { fs.writeFileSync(stateFile, JSON.stringify({ races: racesSent, photos: [...photosSent] })); } catch { /* next round */ } };

  let primed = false;
  let todayFp = null;
  let trackFp = null;
  const garageFp = {};
  // Décaissements already in Firebase (id -> fingerprint), so only changes are sent.
  let disbPushed = new Map();
  // Saved races do not change: their laps are fetched once, for the fuel they burned.
  const raceDetails = new Map();
  // Free runs of past days, read once each (day -> stints).
  const stintDays = new Map();
  let liveFp = null;
  let liveActive = false;
  let lastPushAt = 0;
  let busy = false;
  let liveBusy = false;
  let tick = 0;
  const warned = new Set();
  const warnOnce = (key, message) => { if (!warned.has(key)) { warned.add(key); log(message); } };

  // What is already in Firebase, by id: anything there that the desk no longer has (deleted,
  // payment undone) is removed on the first round.
  async function prime() {
    for (const prefix of Object.keys(pushed)) {
      const keys = await cloudGet(`reports/${prefix}.json?shallow=true`);
      for (const id of Object.keys(keys || {})) pushed[prefix].set(id, null);
    }
    const disbKeys = await cloudGet("reports/disbursements.json?shallow=true");
    for (const id of Object.keys(disbKeys || {})) disbPushed.set(id, null);
    primed = true;
  }

  async function round() {
    if (busy) return;
    busy = true;
    try {
      if (!primed) await prime();
      const updates = {};
      const accepted = [];

      // ---- money and reservations, from the desk
      let desk = null;
      try { desk = await getJson(`${deskUrl}/api/queue`); }
      catch (e) { warnOnce("desk", `[rapports] accueil injoignable (${e.message}) : revenus non envoyés`); }
      if (desk && Array.isArray(desk.reservations)) {
        warned.delete("desk");
        const reports = buildReports(desk.reservations, readSignups(), new Date());
        for (const prefix of Object.keys(pushed)) {
          const { updates: u, fingerprints } = diffUpdates(prefix, reports[prefix], pushed[prefix]);
          Object.assign(updates, u);
          accepted.push(() => { pushed[prefix] = new Map(Object.entries(fingerprints)); });
        }
        const fp = JSON.stringify(reports.today);
        if (fp !== todayFp) {
          updates.today = { ...reports.today, updatedAt: Date.now() };
          accepted.push(() => { todayFp = fp; });
        }
      }

      // ---- the circuit, from the desk
      try {
        const doc = trackDoc((await getJson(`${deskUrl}/api/track`)).layout);
        const fp = JSON.stringify(doc);
        if (doc && fp !== trackFp) {
          updates.track = doc;
          accepted.push(() => { trackFp = fp; });
        }
      } catch { /* the desk is unreachable: already reported above */ }

      // ---- décaissements, from the desk: every request with its whole history
      try {
        const body = await getJson(`${deskUrl}/api/disbursements`);
        if (body && Array.isArray(body.disbursements)) {
          const desired = Object.fromEntries(body.disbursements.map((d) => [d.id, disbursementDoc(d)]));
          const { updates: u, fingerprints } = diffUpdates("disbursements", desired, disbPushed);
          Object.assign(updates, u);
          accepted.push(() => { disbPushed = new Map(Object.entries(fingerprints)); });
          // Their photos, once each and apart from the list (/attachments, read by the API one
          // at a time), a few per round so a batch of photos never holds up the rest.
          let uploads = 0;
          for (const d of body.disbursements) {
            for (const a of d.attachments || []) {
              const key = `${d.id}/${a.id}`;
              if (photosSent.has(key) || uploads >= 4) continue;
              try {
                const res = await fetch(`${deskUrl}/api/disbursements/${encodeURIComponent(d.id)}/pieces/${encodeURIComponent(a.id)}`, { signal: AbortSignal.timeout(15_000) });
                if (!res.ok) continue;
                const data = Buffer.from(await res.arrayBuffer()).toString("base64");
                await cloudPut(`attachments/disbursements/${d.id}/${a.id}`, { type: a.type, size: a.size, addedAt: Date.parse(a.addedAt) || null, data });
                photosSent.add(key);
                uploads += 1;
                saveState();
              } catch { /* this photo next round */ }
            }
          }
        }
      } catch { /* a desk started before décaissements existed has none to send */ }

      // ---- races, from Timing Control
      let list = null;
      try { list = (await getJson(`${timingUrl}/api/races`)).races; }
      catch (e) { warnOnce("chrono", `[rapports] chrono injoignable (${e.message}) : courses non envoyées`); }
      if (Array.isArray(list)) {
        warned.delete("chrono");
        const sentNow = {};
        for (const summary of list) {
          if (!summary || !summary.raceId || isSimulated(summary)) continue;
          const fp = `${summary.state}|${summary.savedAt}|${summary.racers}`;
          if (racesSent[summary.raceId] === fp) continue;
          try {
            const detail = (await getJson(`${timingUrl}/api/races/${encodeURIComponent(summary.raceId)}`)).race;
            if (!detail) continue;
            raceDetails.set(summary.raceId, detail);
            updates[`races/${summary.raceId}`] = raceDoc(detail);
            sentNow[summary.raceId] = fp;
          } catch { /* this race next round */ }
        }
        accepted.push(() => { Object.assign(racesSent, sentNow); if (Object.keys(sentNow).length) saveState(); });
      }

      // ---- the Garage: the barrel's running stock, today's fuel and the spare parts
      try {
        const today = fuelDayKey(Date.now());
        const [fuelFile, garageFile] = await Promise.all([
          getJson(`${deskUrl}/api/fuel`).catch(() => null),
          getJson(`${deskUrl}/api/garage`).catch(() => null),
        ]);
        // The stock runs from its start (day one, or the last fill): every race and free run
        // since then counts, not only today's.
        const tank = tankFrom(fuelFile, (fuelFile && fuelFile.settings && fuelFile.settings.capacityL) || 500);
        const since = tank ? Date.parse(tank.baseAt) : new Date(`${today}T00:00:00`).getTime();
        const races = [];
        for (const summary of Array.isArray(list) ? list : []) {
          const when = (summary.finishedAt ?? summary.startedAt ?? summary.savedAt ?? 0) * 1000;
          if (!summary.raceId || isSimulated(summary) || (when < since && fuelDayKey(when) !== today)) continue;
          if (!raceDetails.has(summary.raceId)) {
            try {
              const detail = (await getJson(`${timingUrl}/api/races/${encodeURIComponent(summary.raceId)}`)).race;
              if (detail) raceDetails.set(summary.raceId, detail);
            } catch { /* next round */ }
          }
          if (raceDetails.has(summary.raceId)) races.push(raceDetails.get(summary.raceId));
        }
        // Karts going round outside a race, day by day since the start; a past day never changes,
        // so it is read once. An older chrono has no activity log: none counted.
        const stints = [];
        for (const day of daysFrom(fuelDayKey(since), today)) {
          if (day !== today && stintDays.has(day)) { stints.push(...stintDays.get(day)); continue; }
          const activity = await getJson(`${timingUrl}/api/activity/${day}`).catch(() => null);
          const dayStints = (activity && activity.stints) || [];
          if (day !== today && activity) stintDays.set(day, dayStints);
          stints.push(...dayStints);
        }
        const doc = garageDoc({ fuelFile, garageFile, races, stints });
        const pieces = { "garage/fuel/today": doc.fuelToday, [`garage/fuel/days/${today}`]: doc.fuelDay };
        if (doc.parts) pieces["garage/parts"] = doc.parts;
        for (const [path, value] of Object.entries(pieces)) {
          const fp = JSON.stringify(value);
          if (garageFp[path] === fp) continue;
          updates[path] = path === "garage/fuel/today" ? { ...value, updatedAt: Date.now() } : value;
          accepted.push(() => { garageFp[path] = fp; });
        }
      } catch (e) {
        warnOnce(`garage:${e.message}`, `[rapports] garage non envoyé : ${e.message}`);
      }

      const changed = Object.keys(updates).length;
      if (changed || Date.now() - lastPushAt > HEARTBEAT_MS) {
        updates.meta = { venue: "MegaKart Fès", version: 1, updatedAt: Date.now() };
        await pushUpdates(updates);
        for (const apply of accepted) apply();
        lastPushAt = Date.now();
        if (changed) log(`[rapports] ${changed} élément${changed > 1 ? "s" : ""} envoyé${changed > 1 ? "s" : ""} à Firebase`);
      }
    } catch (e) {
      warnOnce(`push:${e.message}`, `[rapports] envoi impossible : ${e.message}`);
    } finally {
      busy = false;
    }
  }

  async function live() {
    tick += 1;
    if (liveBusy || (!liveActive && tick % IDLE_LIVE_EVERY !== 0)) return;
    liveBusy = true;
    try {
      const current = (await getJson(`${timingUrl}/api/race/current`, 2500)).race;
      const doc = liveDoc(current);
      liveActive = doc.state === "RUNNING" || doc.state === "PREPARED";
      const fp = JSON.stringify(doc);
      if (fp !== liveFp) {
        await cloudPut("reports/live", { ...doc, updatedAt: Date.now() });
        liveFp = fp;
        // A race just ended: send it with the next round rather than 30 s later.
        if (doc.state === "FINISHED") void round();
      }
    } catch { /* chrono closed: the app keeps the last state, with its updatedAt */ }
    finally { liveBusy = false; }
  }

  // ---- the app's answers to décaissements ------------------------------------------------
  // The MegaKart API writes each decision to /decisions/disbursements/<id>; here it is applied at
  // the desk (which checks it and adds it to the history), the updated request is sent back at
  // once, and the decision is removed. A decision the desk cannot take yet (desk closed, or too
  // old to know décaissements) stays, and is tried again.
  let decisionsBusy = false;
  async function applyDecisions() {
    if (decisionsBusy) return;
    decisionsBusy = true;
    try {
      const waiting = await cloudGet("decisions/disbursements.json");
      for (const [id, decision] of Object.entries(waiting || {})) {
        let res;
        try {
          res = await fetch(`${deskUrl}/api/disbursements/${encodeURIComponent(id)}/decision`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(decision), signal: AbortSignal.timeout(8000),
          });
        } catch { warnOnce("decisions-desk", "[décaissements] accueil injoignable : décision gardée pour plus tard"); continue; }
        const body = await res.json().catch(() => null);
        if (res.ok && body && body.id) {
          warned.delete("decisions-desk");
          await cloudPatch("reports", { [`disbursements/${body.id}`]: disbursementDoc(body) });
          disbPushed.set(body.id, JSON.stringify(disbursementDoc(body)));
          log(`[décaissements] ${body.code} ${body.status === "APPROUVE" ? "approuvé" : "refusé"} par ${decision.by} (application)`);
        } else if (!body || body.error === "Route inconnue.") {
          warnOnce("decisions-old", "[décaissements] l'accueil ne connaît pas encore les décaissements : appuyez sur Synchroniser");
          continue;   // kept until the desk is updated
        } else {
          log(`[décaissements] décision pour ${id} non appliquée : ${body.error}`);
        }
        // Applied, or refused for good (already decided, unknown request): done either way.
        await cloudPatch("decisions", { [`disbursements/${id}`]: null });
      }
    } catch { /* Firebase unreachable: next time */ }
    finally { decisionsBusy = false; }
  }
  setInterval(() => { void applyDecisions(); }, 5_000);

  setTimeout(() => { void round(); }, 5_000);
  setInterval(() => { void round(); }, DESK_EVERY_MS);
  setInterval(() => { void live(); }, LIVE_EVERY_MS);
  log("[rapports] envoi des revenus et des courses vers Firebase activé");
}
