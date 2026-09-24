// MegaKart Apex Live Bridge — READ-ONLY towards Apex.
// Taps the GoKarts live feed (TCP 30001, unauthenticated), parses the pipe-delimited
// protocol, keeps normalized live-session state, and serves it to the browser:
//   GET /live    -> JSON snapshot (CORS enabled)
//   GET /stream  -> Server-Sent Events (pushes on every change)
//   GET /history -> archived results of finished sessions (newest first)
//   GET /sessions -> GoServer's session plan for the day
//   GET /capture -> raw captured feed lines (debug / protocol finalization)
//   GET /health  -> { ok, connected, feed }
//   GET /inscription -> client sign-up form for phones on the venue Wi-Fi
//   POST /signup  -> a filled sign-up (from those phones); stored in out/signups.json
//   GET/POST /signups -> read the sign-ups / set an entry's status (this PC only: personal data)
//   GET  /active-session -> the MegaKart session the dashboard marked active (or null)
//   POST /active-session -> dashboard pushes that session (from this PC only): its
//                           transponder → driver/kart roster names the live board and is
//                           stamped onto the archived results. Body {"id":null} clears it.
//   GET /        -> built-in live viewer page
// It SENDS NOTHING to Apex and changes nothing there. Zero npm dependencies (Node built-ins only).
//
// Run:  node bridge.mjs           (defaults: feed 127.0.0.1:30001, http :8787)
// Env:  APEX_HOST, APEX_FEED_PORT, BRIDGE_PORT

import net from "node:net";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DRIVER_COLORS, PACKS, SIGNUP_PAGE } from "./signup-page.mjs";
import { createChrono } from "./chrono.mjs";
import { createKartMap } from "./kart-map.mjs";
import { cloudConfigured, cloudGet, cloudPatch, cloudPut } from "./cloud.mjs";
import { SEED_OFFERS, offerFits, offerTotal } from "../../lib/offer-rules.mjs";
import { startReportSync } from "./cloud-reports.mjs";

const HOST = process.env.APEX_HOST ?? "127.0.0.1";
const FEED_PORT = Number(process.env.APEX_FEED_PORT ?? 30001);
const HTTP_PORT = Number(process.env.BRIDGE_PORT ?? 8787);
const REPLAY = process.env.APEX_REPLAY || null; // path to a capture.log to replay (dev/demo)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_STARTED_AT = Date.now();
// The code this process runs; newer on disk than BRIDGE_STARTED_AT means a restart is due.
const BRIDGE_CODE = ["bridge.mjs", "signup-page.mjs", "cloud.mjs", "chrono.mjs", "kart-map.mjs", "cloud-reports.mjs", "report-docs.mjs"].map((f) => path.join(__dirname, f))
  .concat(path.join(__dirname, "..", "..", "lib", "offer-rules.mjs"));
const OUT_DIR = path.join(__dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });
const CAPTURE = path.join(OUT_DIR, "capture.log");

// Operator-editable transponder -> {kartNumber, name} roster. Reloaded live on file change.
const ROSTER_FILE = path.join(__dirname, "roster.json");
let roster = {};
function loadRoster() {
  try {
    const j = JSON.parse(fs.readFileSync(ROSTER_FILE, "utf8"));
    roster = j.roster || {};
    console.log(`[roster] loaded ${Object.keys(roster).length} entr${Object.keys(roster).length === 1 ? "y" : "ies"}`);
  } catch (e) { roster = {}; console.log("[roster] none/invalid:", e.message); }
}
loadRoster();
try { fs.watchFile(ROSTER_FILE, { interval: 1500 }, () => { loadRoster(); normalizeRecords(); bump(); }); } catch {}

// Active MegaKart session, pushed by the dashboard (POST /active-session). Its drivers take
// precedence over roster.json for naming, and finished sessions are archived with its id so
// the dashboard can link results back to the session it created. Persisted across restarts.
const ACTIVE_FILE = path.join(OUT_DIR, "active-session.json");
let activeSession = null;
try { activeSession = sanitizeActiveSession(JSON.parse(fs.readFileSync(ACTIVE_FILE, "utf8"))); } catch { activeSession = null; }

function cleanText(v, max) {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) : "";
}
function sanitizeActiveSession(body) {
  if (!body || typeof body !== "object" || !body.id) return null;
  const drivers = Array.isArray(body.drivers) ? body.drivers.slice(0, 60) : [];
  return {
    id: cleanText(String(body.id), 64),
    name: cleanText(body.name, 80),
    type: cleanText(body.type, 16),
    drivers: drivers
      .map((d) => ({
        transponder: cleanText(d && d.transponder != null ? String(d.transponder) : "", 16),
        kartNumber: Number.isFinite(+(d && d.kartNumber)) ? +d.kartNumber : null,
        name: cleanText(d && d.name, 48),
        color: d && +d.color >= 1 && +d.color <= 8 ? +d.color : null, // pilot picked at sign-up
      }))
      .filter((d) => d.transponder && d.name),
    updatedAt: new Date().toISOString(),
  };
}
function sessionDriverFor(transponder) {
  return activeSession ? activeSession.drivers.find((d) => d.transponder === String(transponder)) || null : null;
}

// Session history archive: each finished session's results, appended once, newest first.
const HISTORY_FILE = path.join(OUT_DIR, "history.json");
function readHistory() {
  try { const v = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
// GoServer re-exports the day's session plan here (unauthenticated). Gives the session list
// with type/duration/state/driver-COUNT (names are not in this export).
const SESSIONS_JSON = process.env.APEX_SESSIONS_JSON || "C:\\MegaK\\ApexImport\\sessions.json";
function readGokartsSessions() {
  try {
    const d = JSON.parse(fs.readFileSync(SESSIONS_JSON, "utf8").replace(/^﻿/, "")); // strip BOM
    const track = d.tracks && d.tracks[0] ? d.tracks[0] : { name: "", sessions: [] };
    const sessions = (track.sessions || []).filter(
      (s) => (s.title && s.title !== "") || (s.state && s.state !== "") || (s.drivers && s.drivers !== 0)
    );
    return { date: d.date ?? null, track: track.name ?? null, sessions };
  } catch {
    return { date: null, track: null, sessions: [] };
  }
}
function archiveSession() {
  if (state._archived || state.drivers.length === 0) return;
  state._archived = true;
  const laps = state.drivers.reduce((m, d) => Math.max(m, d.laps || 0), 0);
  const best = state.drivers.filter((d) => d.bestLapMs != null).sort((a, b) => a.bestLapMs - b.bestLapMs)[0] || null;
  const entry = {
    id: `S-${Date.now().toString(36).toUpperCase()}`,
    archivedAt: new Date().toISOString(),
    source: state.source,
    laps,
    bestLapMs: best ? best.bestLapMs : null,
    bestBy: best ? best.name : null,
    winner: state.drivers[0] ? state.drivers[0].name : null,
    megakart: activeSession ? { sessionId: activeSession.id, name: activeSession.name, type: activeSession.type } : null,
    drivers: state.drivers.map((d) => ({ ...d })),
  };
  const hist = readHistory();
  hist.unshift(entry);
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(hist.slice(0, 500))); } catch (e) { console.log("[history] write failed:", e.message); }
  state.lastArchive = { id: entry.id, archivedAt: entry.archivedAt, megakartSessionId: entry.megakart ? entry.megakart.sessionId : null };
  console.log(`[history] archived session ${entry.id} (${state.drivers.length} drivers, ${laps} laps${entry.megakart ? `, MegaKart ${entry.megakart.sessionId}` : ""})`);
}

/**
 * Archive a MegaKart-counted race into the same history the dashboard already reads, tagged
 * `origin: "megakart"` so it is never confused with a GoKarts-classified session. The
 * integrity block travels with it: a result counted across a feed outage must stay marked
 * as incomplete forever, not just while it is on screen.
 */
function archiveChrono(snap) {
  const cls = snap && snap.classification;
  if (!cls || !cls.rows || cls.rows.length === 0) return null;
  const entry = {
    id: `MK-${Date.now().toString(36).toUpperCase()}`,
    origin: "megakart",
    archivedAt: new Date().toISOString(),
    source: state.source,
    startedAt: snap.startedAt,
    stoppedAt: snap.stoppedAt,
    durationMs: snap.elapsedMs,
    laps: cls.rows.reduce((m, r) => Math.max(m, r.laps || 0), 0),
    bestLapMs: cls.fastest ? cls.fastest.bestLapMs : null,
    bestBy: cls.fastest ? cls.fastest.name || cls.fastest.transponder : null,
    winner: cls.rows[0] ? cls.rows[0].name || cls.rows[0].transponder : null,
    integrity: cls.integrity,
    megakart: snap.sessionId ? { sessionId: snap.sessionId, name: snap.name, type: "chrono" } : null,
    drivers: cls.rows.map((r) => ({ ...r })),
  };
  const hist = readHistory();
  hist.unshift(entry);
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(hist.slice(0, 500))); } catch (e) { console.log("[history] write failed:", e.message); }
  state.lastArchive = { id: entry.id, archivedAt: entry.archivedAt, megakartSessionId: entry.megakart ? entry.megakart.sessionId : null };
  return entry;
}

// ------------------------------------------------------------ client sign-ups
// Clients scan a printed QR code, fill the form served at /inscription on the venue Wi-Fi, and
// the entry lands here. Personal data (phone, email, birth date, waiver) stays in this file on
// the venue PC — it is never sent anywhere. The dashboard reads it from this machine only.
const SIGNUPS_FILE = path.join(OUT_DIR, "signups.json");
const SIGNUP_LIMIT = 2000;
const signupHits = new Map(); // ip -> timestamps, to stop a single phone flooding the list

function readSignups() {
  try { const v = JSON.parse(fs.readFileSync(SIGNUPS_FILE, "utf8")); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function writeSignups(list) {
  try { fs.writeFileSync(SIGNUPS_FILE, JSON.stringify(list.slice(0, SIGNUP_LIMIT))); return true; }
  catch (e) { console.log("[signup] write failed:", e.message); return false; }
}
function ageFrom(birthdate) {
  const born = new Date(birthdate);
  if (isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const monthDay = now.getMonth() - born.getMonth() || now.getDate() - born.getDate();
  if (monthDay < 0) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}
const COLOR_IDS = DRIVER_COLORS.map((c) => c.id);
const validEmail = (email) => !email || /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email);
const colorOr = (value, fallback) => (COLOR_IDS.includes(Number(value)) ? Number(value) : fallback);

// Two kart categories: JUNIOR (8-14, from 130 cm) and GT, the adult kart (from 160 cm).
const JUNIOR_MAX_AGE = 14;
const MIN_AGE = 8;
const MIN_HEIGHT = { JUNIOR: 130, GT: 160 };
const categoryFor = (age) => (age <= JUNIOR_MAX_AGE ? "JUNIOR" : "GT");
function playerCategory(age, height) {
  const category = categoryFor(age);
  return {
    category,
    height: height ?? null,
    // Too short for that kart: flagged so the counter checks before handing over a kart.
    heightOk: height != null && height >= MIN_HEIGHT[category],
  };
}

// Returns the stored entry, or a string describing what the phone got wrong. One entry is a whole
// group: the person who registered plus the friends they added, each with their pilot colour.
function buildSignup(body) {
  if (!body || typeof body !== "object") return "Formulaire illisible.";
  const name = cleanText(body.name, 60);
  const phone = cleanText(body.phone, 24);
  const email = cleanText(body.email, 80);
  const birthdate = cleanText(body.birthdate, 10); // older form versions sent a date instead of an age
  if (name.length < 2) return "Nom manquant.";
  if (phone.replace(/\D/g, "").length < 6) return "Téléphone invalide.";
  if (!validEmail(email)) return "Email invalide.";
  const age = Number.isFinite(+body.age) && +body.age >= MIN_AGE ? Math.round(+body.age) : ageFrom(birthdate);
  if (age == null || age < MIN_AGE || age > 99) return `Âge invalide (à partir de ${MIN_AGE} ans).`;
  const height = Number.isFinite(+body.height) && +body.height >= 100 && +body.height <= 220 ? Math.round(+body.height) : null;
  if (height == null) return "Indiquez la taille du pilote.";
  if (body.waiver !== true) return "Règlement de piste non accepté.";
  // The charte de bonne conduite is signed on the phone at step 2; a sign-up without that
  // signature is not a sign-up. Stored as a PNG data URL, as drawn.
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!signature.startsWith("data:image/png;base64,") || signature.length < 200) return "Charte non signée.";
  if (signature.length > 120_000) return "Signature trop lourde.";
  const charter = cleanText(body.charter, 24) || "charte-v1";

  const rawTeam = Array.isArray(body.team) ? body.team.slice(0, 11) : [];
  const used = new Set([colorOr(body.color, 1)]);
  const team = [];
  for (const mate of rawTeam) {
    const mateName = cleanText(mate && mate.name, 60);
    const mateAge = Number(mate && mate.age);
    const matePhone = cleanText(mate && mate.phone, 24);
    const mateEmail = cleanText(mate && mate.email, 80);
    const mateHeight = Number.isFinite(+(mate && mate.height)) && +mate.height >= 100 && +mate.height <= 220 ? Math.round(+mate.height) : null;
    if (mateName.length < 2) return "Nom d'un pilote manquant.";
    if (matePhone.replace(/\D/g, "").length < 6) return "Téléphone d'un pilote invalide.";
    if (!(mateAge >= MIN_AGE && mateAge <= 99)) return `Âge d'un pilote invalide (à partir de ${MIN_AGE} ans).`;
    if (mateHeight == null) return "Indiquez la taille de chaque pilote.";
    if (!validEmail(mateEmail)) return "Email d'un pilote invalide.";
    // Keep colours unique inside a group, so the screen never shows two identical pilots.
    let color = colorOr(mate && mate.color, 0);
    if (!color || used.has(color)) color = COLOR_IDS.find((id) => !used.has(id)) ?? color ?? 1;
    used.add(color);
    team.push({ name: mateName, phone: matePhone, age: mateAge, email: mateEmail || null, color, ...playerCategory(mateAge, mateHeight) });
  }
  // The phone chooses a PACK, never a price. The amount owed is computed here from the catalog
  // and the actual roster, so a tampered request cannot change what the client pays - nor buy
  // a group price for a group the offer is not for.
  const priced = priceSignup(cleanText(body.pack, 40), 1 + team.length);
  if (priced.error) return priced.error;

  const id = `C-${Date.now().toString(36).toUpperCase()}`;
  return {
    id,
    code: id.slice(-4), // short code the client reads out at the counter
    createdAt: new Date().toISOString(),
    name,
    phone,
    email: email || null,
    birthdate: birthdate || null,
    age,
    ...playerCategory(age, height),
    color: colorOr(body.color, 1),
    team,
    waiver: true,
    ...priced.fields,
    charter,
    signature,
    signedAt: Number.isFinite(+body.signedAt) ? Math.round(+body.signedAt) : Date.now(),
    offers: body.offers === true,
    status: "new", // new → assigned (put in a session) → archived
  };
}

// ---------------------------------------------------- the offer catalog
// The dashboard's Packs & ventes page is the one place offers are edited; the desk keeps them in
// catalog.json. The bridge reads them from there every 30 s (and at once when the dashboard
// saves), prices every sign-up with them, serves them to the local form at /catalog.json and
// publishes them to the Realtime Database for the hosted form. Offers are public marketing
// text - names, prices, descriptions - never anything about a client.
//
// If the desk cannot be reached, the last catalog read is kept; a bridge that never reached a
// desk (the one on Render) reads the published copy instead, and never publishes over it.
const CATALOG_SYNC_MS = 30_000;
let catalog = { offers: SEED_OFFERS, savedAt: null, source: "seed" };
let catalogPublished = null;
let catalogWarned = false;

function publicCatalog() {
  return { offers: catalog.offers.filter((o) => o && o.enabled !== false), savedAt: catalog.savedAt || null, source: catalog.source };
}

async function refreshCatalog() {
  let fromDesk = false;
  try {
    const res = await fetch(`${DESK_URL}/api/catalog`, { signal: AbortSignal.timeout(4000) });
    const type = res.headers.get("content-type") || "";
    if (res.ok && type.includes("application/json")) {
      const body = await res.json();
      fromDesk = true;
      catalog = body && Array.isArray(body.offers) && body.offers.length
        ? { offers: body.offers, savedAt: body.savedAt || null, source: "desk" }
        // The desk answered but nobody has edited the catalog yet: the dashboard shows the
        // seed, so the form must show the same seed.
        : { offers: SEED_OFFERS, savedAt: null, source: "seed" };
    } else if (!catalogWarned) {
      catalogWarned = true;
      console.log("[catalog] the desk does not serve /api/catalog yet (restart it): using the last known offers");
    }
  } catch { /* desk unreachable: keep what we have */ }

  if (!cloudConfigured()) return;
  if (!fromDesk) {
    // A bridge that has read the desk keeps the desk's copy through an outage.
    if (catalog.source === "desk") return;
    // Never reached a desk: follow the published catalog, so online sign-ups are priced with it.
    try {
      const published = await cloudGet("catalog.json");
      if (published && Array.isArray(published.offers) && published.offers.length) {
        catalog = { offers: published.offers, savedAt: published.savedAt || null, source: "cloud" };
      }
    } catch { /* keep the seed */ }
    return;
  }
  const body = publicCatalog();
  const fingerprint = JSON.stringify(body);
  if (fingerprint === catalogPublished) return;
  try {
    await cloudPut("catalog.json", { ...body, publishedAt: Date.now() });
    catalogPublished = fingerprint;
    console.log(`[catalog] ${body.offers.length} offres publiées pour le formulaire en ligne`);
  } catch (e) {
    console.log(`[catalog] publication impossible: ${e.message}`);
  }
}
setInterval(() => { refreshCatalog().catch(() => {}); }, CATALOG_SYNC_MS);
setTimeout(() => { refreshCatalog().catch(() => {}); }, 1_000);

// Forms built before the catalog sent p1/p2/p3; honour them while such a page can still be open.
const legacyPack = (id) => PACKS.find((p) => p.id === id && p.enabled) || null;

/** The pack fields stored on a sign-up, or an error for the phone. */
function priceSignup(packId, pilots) {
  const none = { pack: null, packLabel: null, packPriceMad: null, packTotalMad: null, packBasis: null, packPeriod: null };
  if (!packId) return { fields: none };
  const offer = catalog.offers.find((o) => o && o.id === packId && o.enabled !== false);
  if (offer) {
    if (!offerFits(offer, pilots)) {
      return { error: `La formule « ${offer.name} » ne correspond pas à ${pilots} pilote${pilots > 1 ? "s" : ""}. Choisissez-en une autre.` };
    }
    return { fields: {
      pack: offer.id, packLabel: offer.name,
      packPriceMad: Math.round(Number(offer.price)) || 0,        // the catalog price: per person, or for the group
      packTotalMad: offerTotal(offer, pilots),                   // what the counter collects
      packBasis: offer.basis === "groupe" ? "groupe" : "personne",
      packPeriod: offer.period || "unique",
    } };
  }
  const legacy = legacyPack(packId);
  if (legacy) {
    return { fields: { ...none, pack: legacy.id, packLabel: legacy.label, packPriceMad: legacy.priceMad,
                       packTotalMad: legacy.priceMad * pilots, packBasis: "personne", packPeriod: "unique" } };
  }
  return { error: "Cette formule n'est plus proposée. Rechargez la page et choisissez-en une autre." };
}

function pricedOrFlagged(packId, pilots) {
  const priced = priceSignup(packId, pilots);
  if (!priced.error) return priced.fields;
  const offer = catalog.offers.find((o) => o && o.id === packId);
  return { pack: packId || null, packLabel: `${offer ? offer.name : packId} · à vérifier`,
           packPriceMad: null, packTotalMad: null, packBasis: null, packPeriod: null };
}

// ---------------------------------------------------- hand-off to the reservation desk
// A group that signed up on a phone belongs in the caisse queue BEFORE it reaches a session:
// the desk server (tools/reservations/desk.mjs) owns payment, so we hand the group over and
// keep the queue code on the sign-up. The desk stays the single source of truth for money.
// 5190: the desk server moved there so the dashboard keeps the address (and the browser
// storage) the venue already uses. Two desks on two ports each keep their own copy of the
// queue in memory, so pointing this at the wrong one loses sign-ups from the operator's view.
const DESK_URL = process.env.DESK_URL || "http://127.0.0.1:5190";

async function sendSignupToDesk(entry) {
  const players = signupPlayers(entry);
  const base = {
    contactName: entry.name,
    phone: entry.phone,
    email: entry.email || "",
    // The desk asks for a kart colour (blue/black/green karts); the pilot picked at sign-up is
    // an avatar, not a kart, so we leave the desk to default it and the cashier assigns karts.
    pilots: players.map((p) => ({ fullName: p.name })),
    paymentMethod: "Espèces",
    // What the cashier must collect: the pack, its per-driver price, and the total for this
    // group. Computed here, not sent by the phone.
    pack: entry.pack || null,
    packLabel: entry.packLabel || null,
    amountMad: entry.packTotalMad ?? null,
  };
  const post = (channel) =>
    fetch(`${DESK_URL}/api/reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": entry.id },
      body: JSON.stringify({ ...base, channel }),
    });
  try {
    // "enligne" is the truthful channel; it demands a Moroccan number, so a foreign or odd one
    // falls back to the counter channel rather than leaving the group out of the queue.
    let res = await post("enligne");
    if (res.status === 400) res = await post("guichet");
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.code) return { code: body.code }; // already queued for this phone
    if (!res.ok) return { error: body.error || `borne ${res.status}` };
    return { code: body.code };
  } catch (e) {
    return { error: `borne injoignable (${e.message})` };
  }
}

/** Remember where the sign-up landed in the queue, so the dashboard can show its payment state. */
// ---------------------------------------------------------------------------------------------
// QR sign-ups made ONLINE (the printed poster -> mega-karts.web.app/i) write straight to the
// Realtime Database and never pass through this PC. Without this, they never reach the caisse:
// no queue entry, no "encaisser", no kart. So the bridge pulls them in, the same way a venue
// Wi-Fi sign-up arrives, and hands them to the desk. From then on they are ordinary sign-ups.
//
// Needs the service-account key (cloud.mjs); without it this is a no-op and says so once.
const CLOUD_SYNC_MS = 20_000;
let cloudSyncWarned = false;

function cloudToLocal(id, c) {
  const created = typeof c.createdAt === "number" ? new Date(c.createdAt) : new Date();
  const players = Object.values(c.players || {}).filter((p) => p && p.name);
  const mates = players.slice(1);   // the first player is the registrant, already the entry itself
  const used = new Set([colorOr(c.color, 1)]);
  const team = mates.map((m) => {
    let color = colorOr(m.color, 0);
    if (!color || used.has(color)) color = COLOR_IDS.find((x) => !used.has(x)) ?? color ?? 1;
    used.add(color);
    return { name: String(m.name).slice(0, 60), phone: m.phone ? String(m.phone).slice(0, 24) : "",
             age: Number(m.age) || 0, email: m.email || null, color,
             ...playerCategory(Number(m.age) || 0, Number(m.height) || null) };
  });
  return {
    id, code: id.slice(-4), createdAt: created.toISOString(),
    name: String(c.name || "").slice(0, 60), phone: String(c.phone || "").slice(0, 24),
    email: c.email || null, birthdate: null, age: Number(c.age) || 0,
    ...playerCategory(Number(c.age) || 0, Number(c.height) || null),
    color: colorOr(c.color, 1), team, waiver: true,
    // Already saved online, so never refused here: a pack that does not fit is shown to the
    // cashier as "à vérifier" with no amount, rather than losing the client.
    ...pricedOrFlagged(c.pack ? String(c.pack).slice(0, 40) : "", 1 + team.length),
    charter: c.charter || null, signature: c.signature || null, signedAt: c.signedAt || null,
    offers: c.offers === true, status: "new", source: "qr-online",
  };
}

async function syncCloudSignups() {
  if (!cloudConfigured()) {
    if (!cloudSyncWarned) {
      cloudSyncWarned = true;
      console.log("[cloud] no service-account key: online QR sign-ups will NOT be imported to the caisse");
    }
    return;
  }
  let cloud;
  try {
    cloud = await cloudGet('signups.json?orderBy="createdAt"&limitToLast=100');
  } catch (e) {
    console.log(`[cloud] read failed: ${e.message}`);
    return;
  }
  if (!cloud || typeof cloud !== "object") return;
  const list = readSignups();
  const known = new Set(list.map((s) => s.id));
  let imported = 0;
  for (const [id, c] of Object.entries(cloud)) {
    if (!c || known.has(id) || c.status !== "new") continue;
    // A sign-up older than a day is not a client at the counter, it is a test or a no-show.
    // Marked stale in the cloud rather than skipped, so it is never re-examined - and never
    // dropped into the queue on some later restart.
    if (typeof c.createdAt === "number" && Date.now() - c.createdAt > CLOUD_MAX_AGE_MS) {
      cloudPatch(`signups/${id}`, { status: "stale" }).catch(() => {});
      continue;
    }
    const entry = cloudToLocal(id, c);
    if (entry.name.length < 2) continue;
    list.unshift(entry);
    known.add(id);
    imported += 1;
    // Mark it on the cloud side so another bridge (Render) does not import it again.
    cloudPatch(`signups/${id}`, { status: "imported", importedBy: os.hostname(), importedAt: Date.now() })
      .catch((e) => console.log(`[cloud] mark ${id} failed: ${e.message}`));
    void sendSignupToDesk(entry).then((result) => recordQueueCode(entry.id, result));
  }
  if (imported) {
    writeSignups(list);
    console.log(`[cloud] imported ${imported} online sign-up${imported > 1 ? "s" : ""} -> caisse`);
  }
}
const CLOUD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
setInterval(() => { syncCloudSignups().catch((e) => console.log(`[cloud] sync error: ${e.message}`)); }, CLOUD_SYNC_MS);

// Revenue and races for the manager's app: payments, day totals, reservations, every saved race
// and the race on track, pushed to /reports (cloud-reports.mjs). Readable only by /staff accounts.
startReportSync({ deskUrl: DESK_URL, readSignups, stateFile: path.join(OUT_DIR, "cloud-reports.json") });
setTimeout(() => { syncCloudSignups().catch(() => {}); }, 3_000);

function recordQueueCode(id, result) {
  const list = readSignups();
  const row = list.find((s) => s.id === id);
  if (!row) return;
  row.queueCode = result.code ?? null;
  row.queueError = result.error ?? null;
  writeSignups(list);
  console.log(result.code ? `[signup] ${id} → file d'attente ${result.code}` : `[signup] ${id} non transmis : ${result.error}`);
}

/** Everyone in a sign-up, the person who registered first. */
function signupPlayers(entry) {
  const first = {
    name: entry.name,
    phone: entry.phone,
    age: entry.age,
    email: entry.email,
    color: entry.color ?? 1,
    height: entry.height ?? null,
    category: entry.category === "CADET" ? "JUNIOR" : entry.category === "SENIOR" ? "GT" : entry.category ?? categoryFor(entry.age ?? 99),
    heightOk: entry.heightOk ?? true,
  };
  return [first, ...(entry.team ?? [])];
}
function rateLimited(ip) {
  const now = Date.now();
  const hits = (signupHits.get(ip) || []).filter((t) => now - t < 600_000);
  hits.push(now);
  signupHits.set(ip, hits);
  if (signupHits.size > 500) signupHits.clear();
  return hits.length > 12; // 12 sign-ups per phone per 10 minutes is already generous
}

// ---------------------------------------------------------------- live state
const state = {
  provider: "APEX_GOKARTS",
  source: `${HOST}:${FEED_PORT}`,
  connected: false,
  updatedAt: null,
  lastSyncTick: null,
  version: 0,
  session: {
    active: false,
    raw: [], // raw STY fields
    type: null,
    state: null,
  },
  messages: [],
  records: {}, // id -> raw fields (NREC/UREC) — verbatim until field map is finalized on live capture
  drivers: [], // normalized rows for the dashboard (best-effort; finalized after a live session)
  counts: { SYNC: 0, STY: 0, MSG: 0, STL: 0, CTL: 0, NREC: 0, UREC: 0, OTHER: 0 },
  unknownTags: {},
  lastArchive: null, // { id, archivedAt, megakartSessionId } of the most recent archived session
};

// Stable equipment map: which transponder is bolted into which kart. Lets the operator work
// in kart numbers everywhere and never retype a transponder id.
const kartMap = createKartMap({
  file: path.join(__dirname, "karts.json"),
  onChange: () => { try { normalizeRecords(); bump(); } catch {} },
});

// ---------------------------------------------------------------- MegaKart chrono
// Our own race window, owned by the dashboard rather than by GoKarts. It lives here in the
// bridge, not in the browser, so a refreshed tab, a sleeping laptop or a second dashboard
// cannot lose a race in progress — the count survives anything short of restarting the bridge.
const CHRONO_FILE = path.join(OUT_DIR, "chrono.json");
const chrono = createChrono({
  resolveDriver: (transponder) => {
    // Kart number comes from the stable equipment map whenever we have it, so a row is
    // labelled "Kart 3" even when nobody has said who is driving yet.
    const mappedKart = kartMap.kartForTransponder(transponder);
    const fromSession = sessionDriverFor(transponder);
    if (fromSession) return { ...fromSession, kartNumber: fromSession.kartNumber ?? (mappedKart ? Number(mappedKart) : null) };
    const r = roster[String(transponder)];
    if (r) return { name: r.name, kartNumber: r.kartNumber ?? (mappedKart ? Number(mappedKart) : null), color: null };
    return mappedKart ? { name: null, kartNumber: Number(mappedKart), color: null } : null;
  },
  onChange: () => { if (typeof bump === "function") bump(); },
});
// Mirrors the live window to disk for POST-HOC DIAGNOSIS only.
// Be clear about what this is not: nothing reads this file back on boot, so a bridge restart
// mid-race still loses the count. Calling it "crash safety" would be a lie. Restoring a race
// across a restart needs an append-only journal replayed at startup — not built yet.
function persistChrono() {
  try { fs.writeFile(CHRONO_FILE, JSON.stringify(chrono.snapshot(), null, 2), () => {}); } catch {}
}

const sseClients = new Set();
function bump() {
  state.version++;
  state.updatedAt = new Date().toISOString();
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of sseClients) res.write(payload);
}
// Derive a race status the way an operator reads it: recent passings => running;
// records present but gone quiet => finished; connected & empty => waiting; else idle.
function deriveStatus() {
  const now = Date.now();
  if (state._lastRecordAt && now - state._lastRecordAt < 12000) return "running";
  if (Object.keys(state.records).length > 0) return "finished";
  return state.connected ? "waiting" : "idle";
}
function publicState() {
  const { counts, _lastRecordAt, ...rest } = state;
  const megakartSession = activeSession ? { id: activeSession.id, name: activeSession.name, type: activeSession.type, drivers: activeSession.drivers.length } : null;
  return { ...rest, status: deriveStatus(), counts, activeSession: megakartSession, chrono: chrono.snapshot() };
}
// Heartbeat so SSE clients see connection + status transitions even when idle.
setInterval(() => bump(), 3000);

// ------------------------------------------------------------- normalization
// NOTE: The NREC/UREC field order is finalized against a real captured session.
// normalizeRecords() is intentionally isolated so it can be tuned in one place.
// NREC decode (validated against a real chrono session — see decode.mjs):
//   NREC | seq | flags | kart | ? | ts_us | lapNo | totalTime_us | lastLap_us | s1 | s2 | s3 | name?
//   flags: 2 = normal passing, 786434 (0xC0002) = best-lap marker,
//          65282 (0xFF02) = session-start marker, 65285 (0xFF05) = session-end/reset (kart 0).
// Each NREC is one loop crossing. We aggregate passings per kart/transponder into a
// live leaderboard. Times are microseconds -> milliseconds.
function normalizeRecords() {
  const byKart = new Map();
  for (const f of Object.values(state.records)) {
    const kart = f[2];
    if (!kart || kart === "0") continue; // skip session start/end markers
    const lapNo = numOrNull(f[5]);
    const totalUs = numOrNull(f[6]);
    const lastUs = numOrNull(f[7]);
    const nameField = f[11] && /\S/.test(f[11]) ? f[11] : null;
    let e = byKart.get(kart);
    if (!e) { e = { kart, name: nameField, laps: 0, lastLapMs: null, bestLapMs: null, totalTimeMs: null }; byKart.set(kart, e); }
    if (nameField) e.name = nameField;
    if (lapNo != null) e.laps = Math.max(e.laps, lapNo);
    if (totalUs != null && totalUs > 0) e.totalTimeMs = Math.round(totalUs / 1000);
    if (lastUs != null && lastUs > 0) {
      const ms = Math.round(lastUs / 1000);
      e.lastLapMs = ms;
      if (e.bestLapMs == null || ms < e.bestLapMs) e.bestLapMs = ms;
    }
  }
  const list = [...byKart.values()].sort((a, b) => b.laps - a.laps || (a.totalTimeMs ?? 9e15) - (b.totalTimeMs ?? 9e15));
  const leader = list[0];
  state.drivers = list.map((d, i) => {
    // Enrich transponder -> kart# + driver name: dashboard session first, then roster.json, then the feed.
    const s = sessionDriverFor(d.kart) || {};
    const r = roster[String(d.kart)] || {};
    const kartNumber = s.kartNumber != null && s.kartNumber > 0 ? s.kartNumber : r.kartNumber;
    return {
      id: d.kart, position: i + 1,
      transponder: d.kart,
      kart: kartNumber != null ? String(kartNumber) : d.kart,
      name: s.name || r.name || d.name || `Kart ${d.kart}`,
      color: s.color ?? null,
      laps: d.laps, lastLapMs: d.lastLapMs, bestLapMs: d.bestLapMs, totalTimeMs: d.totalTimeMs,
      gap: i === 0 ? null
        : d.laps < leader.laps ? `+${leader.laps - d.laps} tr`
        : d.totalTimeMs != null && leader.totalTimeMs != null ? `+${((d.totalTimeMs - leader.totalTimeMs) / 1000).toFixed(3)}` : null,
    };
  });
}
const numOrNull = (v) => (v != null && v !== "" && !isNaN(+v) ? +v : null);
const msOrNull = (v) => {
  if (v == null || v === "") return null;
  // Apex lap times may arrive as "1:02.345" or "62.345" or raw ms — handle common forms.
  if (/^\d+$/.test(v)) return +v;
  const m = String(v).match(/^(?:(\d+):)?(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const min = m[1] ? +m[1] : 0, sec = +m[2], frac = m[3] ? +("0." + m[3]) : 0;
  return Math.round((min * 60 + sec + frac) * 1000);
};

// -------------------------------------------------------------- feed parsing
function handleLine(line) {
  if (!line) return;
  if (!REPLAY) fs.appendFile(CAPTURE, `${new Date().toISOString()}\t${line}\n`, () => {});
  const parts = line.split("|");
  const tag = parts[0];
  const f = parts.slice(1);
  switch (tag) {
    case "SYNC": state.counts.SYNC++; state.lastSyncTick = f[0]; return; // heartbeat: no broadcast
    case "STY":
      state.counts.STY++;
      state.session.raw = f;
      state.session.type = f[0] ?? null;
      state.session.active = !!(f[0] && f[0] !== "0");
      break;
    case "MSG": state.counts.MSG++; state.messages = [line, ...state.messages].slice(0, 20); break;
    case "STL": state.counts.STL++; break;
    case "CTL": state.counts.CTL++; break;
    case "NREC": {
      state.counts.NREC++;
      state._lastRecordAt = Date.now();
      const id = f[0] ?? `n${state.counts.NREC}`;
      // A start marker after an archived session on the same feed port = a new session:
      // clear the finished results so it gets its own leaderboard and its own archive entry.
      if (f[1] === "65282" && state._archived) { state.records = {}; state.drivers = []; state._archived = false; }
      state.records[id] = f;
      normalizeRecords();
      // MegaKart's own chrono counts the SAME crossing independently, from the raw transponder
      // and timestamp only. It ignores GoKarts' lap arithmetic and its 65282/65285 boundaries —
      // our window is opened and closed by the operator in the dashboard.
      chrono.onPassing({ transponder: f[2], tsUs: Number(f[4]), flags: f[1], seq: f[0] });
      if (f[1] === "65285") archiveSession(); // session-end marker → archive the results
      break;
    }
    case "UREC": {
      state.counts.UREC++;
      state._lastRecordAt = Date.now();
      const id = f[0];
      if (id != null) {
        state.records[id] = mergeRecord(state.records[id], f);
        normalizeRecords();
      }
      break;
    }
    default:
      state.counts.OTHER++;
      if (!(tag in state.unknownTags)) state.unknownTags[tag] = line;
  }
  bump();
}
// UREC may carry only changed fields; keep prior values where the update is blank.
function mergeRecord(prev, next) {
  if (!prev) return next;
  const out = next.slice();
  for (let i = 0; i < Math.max(prev.length, next.length); i++) {
    if ((out[i] == null || out[i] === "") && prev[i] != null) out[i] = prev[i];
  }
  return out;
}

// -------------------------------------------------------------- feed client
// The GoKarts live-feed port is DYNAMIC: idle it sits on 30001, but when a session
// starts it moves (session 3 -> 30003, etc.). So we scan a small range and adopt
// whichever port is actively greeting with the SYNC/STY feed protocol.
const SCAN_BASE = Number(process.env.APEX_FEED_BASE ?? 30001);
const SCAN_COUNT = Number(process.env.APEX_FEED_RANGE ?? 12); // 30001..30012
let buffer = "";

function probePort(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: HOST, port });
    let got = "";
    let settled = false;
    const fail = () => { if (settled) return; settled = true; sock.removeAllListeners(); sock.destroy(); resolve(null); };
    const win = () => {
      if (settled) return; settled = true;
      sock.setTimeout(0);
      sock.removeAllListeners("timeout"); sock.removeAllListeners("data"); sock.removeAllListeners("error");
      sock._initial = got;
      resolve(sock);
    };
    sock.setTimeout(1200);
    sock.on("connect", () => sock.setEncoding("utf8"));
    sock.on("data", (d) => { got += d; if (/(?:^|\n)(SYNC|STY|STL|CTL|MSG|NREC|UREC)\|/.test(got)) win(); });
    sock.on("timeout", fail);
    sock.on("error", fail);
  });
}

let lastPort = null;
function adopt(sock, port) {
  // New session = new feed port: start from a clean slate so sessions don't bleed together.
  if (port !== lastPort) { state.records = {}; state.drivers = []; state.messages = []; state._archived = false; lastPort = port; }
  state.source = `${HOST}:${port}`;
  state.connected = true;
  bump();
  console.log(`[feed] connected ${HOST}:${port} (read-only)`);
  if (sock._initial) { feedChunk(sock._initial); }
  sock.setEncoding("utf8");
  sock.on("data", feedChunk);
  const drop = () => {
    if (state.connected) { state.connected = false; bump(); }
    // A race counted across a feed outage has holes we cannot see. Record it so the result
    // is permanently marked incomplete rather than quietly presented as clean.
    chrono.noteFeedDrop();
    console.log("[feed] disconnected; rescanning…");
    setTimeout(discover, 1500);
  };
  sock.on("error", () => {});
  sock.on("close", drop);
}

function feedChunk(chunk) {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).replace(/\r$/, "");
    buffer = buffer.slice(nl + 1);
    handleLine(line);
  }
}

// Scan ALL candidate ports and pick the active session's feed. An active session uses a
// higher port (30003, 30004, …); idle sits on 30001. So we prefer: a greeting that already
// shows a non-idle STY or record traffic, then the highest-numbered listening port.
async function discover() {
  buffer = "";
  const found = [];
  for (let i = 0; i < SCAN_COUNT; i++) {
    const port = SCAN_BASE + i;
    const sock = await probePort(port);
    if (sock) found.push({ port, sock, initial: sock._initial || "" });
  }
  if (found.length === 0) { setTimeout(discover, 1500); return; }
  const score = (g) => {
    if (/(?:^|\n)(NREC|UREC|STL)\|/.test(g.initial)) return 3;
    const m = g.initial.match(/(?:^|\n)STY\|([^|\n]*)/);
    if (m && m[1] && m[1] !== "0") return 2;
    return 1;
  };
  found.sort((a, b) => score(b) - score(a) || b.port - a.port);
  const chosen = found[0];
  for (const g of found) if (g !== chosen) g.sock.destroy();
  adopt(chosen.sock, chosen.port);
}
const connectFeed = discover;

// -------------------------------------------------------------- http server
const VIEWER = fs.existsSync(path.join(__dirname, "viewer.html"))
  ? fs.readFileSync(path.join(__dirname, "viewer.html"), "utf8")
  : "<h1>MegaKart Apex Bridge</h1><p>viewer.html not found</p>";

const isLoopback = (req) => {
  const ip = (req.socket && req.socket.remoteAddress) || "";
  return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.");
};

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")); }
      catch { reject(Object.assign(new Error("invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  const url = (req.url || "/").split("?")[0];
  if (req.method === "OPTIONS") {
    // Preflight for the dashboard's JSON POST; Chrome also asks before a page reaches a local address.
    res.writeHead(204, { ...cors, "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600" });
    res.end();
    return;
  }
  // ---- stable kart ↔ transponder equipment map ------------------------------------------
  if (url === "/karts") {
    if (req.method === "GET") {
      // `seen` lets the dashboard offer "these transponders are passing but belong to no kart",
      // so the table can be built by driving each kart over the loop once instead of by hand.
      const seen = Object.values(state.records).map((f) => f[2]).filter(Boolean);
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ karts: kartMap.all(), unmapped: kartMap.unmapped(seen) }));
      return;
    }
    if (req.method !== "POST") { res.writeHead(405, cors); res.end("method not allowed"); return; }
    if (!isLoopback(req)) { res.writeHead(403, cors); res.end("le mappage des karts ne se modifie que depuis ce PC"); return; }
    readJsonBody(req)
      .then((body) => {
        const r = kartMap.setAll(body && body.karts);
        if (!r.ok) { res.writeHead(400, cors); res.end(r.error || "mappage refusé"); return; }
        console.log(`[karts] mappage mis à jour (${Object.keys(kartMap.all()).length} karts)`);
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ karts: kartMap.all() }));
      })
      .catch(() => { res.writeHead(400, cors); res.end("corps illisible"); });
    return;
  }

  // ---- MegaKart chrono: our own race window -------------------------------------------
  // Start/stop is an OPERATOR action on the timing PC, so it is loopback-only, like
  // /active-session. This counts laps; it does not and cannot start karts.
  if (url === "/chrono" || url.startsWith("/chrono/")) {
    if (req.method === "GET" && url === "/chrono") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(chrono.snapshot()));
      return;
    }
    if (req.method !== "POST") { res.writeHead(405, cors); res.end("method not allowed"); return; }
    if (!isLoopback(req)) { res.writeHead(403, cors); res.end("le chrono ne peut être piloté que depuis ce PC"); return; }

    if (url === "/chrono/start") {
      readJsonBody(req)
        .then((body) => {
          const snap = chrono.start({
            sessionId: body && body.sessionId ? cleanText(String(body.sessionId), 64) : (activeSession ? activeSession.id : null),
            name: body && body.name ? cleanText(String(body.name), 80) : (activeSession ? activeSession.name : null),
            minLapMs: body && body.minLapMs,
          });
          persistChrono();
          console.log(`[chrono] démarré  session=${snap.sessionId ?? "—"}  minLap=${snap.minLapMs}ms`);
          res.writeHead(200, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify(snap));
        })
        .catch(() => { res.writeHead(400, cors); res.end("corps illisible"); });
      return;
    }
    if (url === "/chrono/stop") {
      const snap = chrono.stop();
      persistChrono();
      const archived = archiveChrono(snap);
      console.log(`[chrono] arrêté  pilotes=${snap.classification?.pilots ?? 0}  archivé=${archived ? archived.id : "non"}`);
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ ...snap, archivedAs: archived ? archived.id : null }));
      return;
    }
    if (url === "/chrono/reset") {
      const snap = chrono.reset();
      persistChrono();
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(snap));
      return;
    }
    // Re-derive the board from the SAME crossings under a different guard. This is what makes
    // a mis-set minLapMs a correction rather than a lost race.
    if (url === "/chrono/reclassify") {
      readJsonBody(req)
        .then((body) => {
          const snap = chrono.reclassify({ minLapMs: body && body.minLapMs });
          persistChrono();
          console.log(`[chrono] recalculé  minLap=${snap.minLapMs}ms  pilotes=${snap.classification?.pilots ?? 0}`);
          res.writeHead(200, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify(snap));
        })
        .catch(() => { res.writeHead(400, cors); res.end("corps illisible"); });
      return;
    }
    // The raw evidence behind a result. Deliberately its own route: the ledger can be large
    // and must never ride the 3-second SSE frame.
    if (url === "/chrono/ledger" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(chrono.ledger()));
      return;
    }
    res.writeHead(404, cors); res.end("unknown chrono route");
    return;
  }

  if (url === "/active-session") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(activeSession));
      return;
    }
    if (req.method !== "POST") { res.writeHead(405, cors); res.end("method not allowed"); return; }
    if (!isLoopback(req)) { res.writeHead(403, cors); res.end("active session can only be set from this PC"); return; }
    readJsonBody(req)
      .then((body) => {
        activeSession = sanitizeActiveSession(body);
        try {
          if (activeSession) fs.writeFileSync(ACTIVE_FILE, JSON.stringify(activeSession));
          else fs.rmSync(ACTIVE_FILE, { force: true });
        } catch (e) { console.log("[session] persist failed:", e.message); }
        normalizeRecords();
        bump();
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify(activeSession));
      })
      .catch((e) => { res.writeHead(e.status || 400, cors); res.end(e.message); });
    return;
  }
  if (url === "/catalog.json") {
    // The offers the local form shows: public, like the form itself.
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors });
    res.end(JSON.stringify(publicCatalog()));
    return;
  }
  if (url === "/catalog/sync") {
    // The dashboard just saved the catalog: read it now instead of within 30 s.
    if (req.method !== "POST") { res.writeHead(405, cors); res.end("method not allowed"); return; }
    if (!isLoopback(req)) { res.writeHead(403, cors); res.end("forbidden"); return; }
    refreshCatalog()
      .catch(() => {})
      .then(() => {
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ ok: true, source: catalog.source, offers: publicCatalog().offers.length, published: catalogPublished != null }));
      });
    return;
  }
  if (url === "/inscription") {
    // The form itself: any phone on the venue Wi-Fi may open it.
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(SIGNUP_PAGE);
    return;
  }
  const driverAsset = url.match(/^\/assets\/driver-([1-8])\.png$/);
  if (url === "/assets/logo.png" || url === "/assets/wheel.png" || driverAsset) {
    const file = driverAsset
      ? path.join(__dirname, "..", "..", "public", "drivers", `driver-${driverAsset[1]}.png`)
      : path.join(__dirname, "..", "..", "public", url === "/assets/logo.png" ? "megakart-loader-logo.png" : "megakart-loader-wheel.png");
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, cors); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=86400", ...cors });
      res.end(data);
    });
    return;
  }
  if (url === "/signup") {
    if (req.method !== "POST") { res.writeHead(405, cors); res.end("method not allowed"); return; }
    const ip = (req.socket && req.socket.remoteAddress) || "?";
    if (rateLimited(ip)) { res.writeHead(429, cors); res.end("Trop d'inscriptions depuis cet appareil. Voyez l'accueil."); return; }
    // Room for the signed charter: the signature travels as a PNG data URL, so 8 KB is not enough.
    readJsonBody(req, 256 * 1024)
      .then((body) => {
        const entry = buildSignup(body);
        if (typeof entry === "string") { res.writeHead(400, cors); res.end(entry); return; }
        const list = readSignups();
        list.unshift(entry);
        if (!writeSignups(list)) { res.writeHead(500, cors); res.end("Enregistrement impossible."); return; }
        const players = signupPlayers(entry);
        console.log(`[signup] ${entry.name} (${entry.code}, ${players.length} pilote${players.length > 1 ? "s" : ""})`);
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ ok: true, code: entry.code, id: entry.id, players }));
        // Answer the phone first, then queue the group at the desk: a slow or absent desk must
        // never make a client wait, and the sign-up is already saved either way.
        void sendSignupToDesk(entry).then((result) => recordQueueCode(entry.id, result));
      })
      .catch((e) => { res.writeHead(e.status || 400, cors); res.end("Formulaire illisible."); });
    return;
  }
  if (url === "/signups") {
    // Personal data: readable from this PC only (the dashboard), never from the venue Wi-Fi.
    if (!isLoopback(req)) { res.writeHead(403, cors); res.end("forbidden"); return; }
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors });
      res.end(JSON.stringify(readSignups()));
      return;
    }
    if (req.method !== "POST") { res.writeHead(405, cors); res.end("method not allowed"); return; }
    readJsonBody(req)
      .then((body) => {
        const id = body && typeof body.id === "string" ? body.id : null;
        const status = body && ["new", "assigned", "archived"].includes(body.status) ? body.status : null;
        if (!id || !status) { res.writeHead(400, cors); res.end("invalid status update"); return; }
        const list = readSignups();
        const entry = list.find((s) => s.id === id);
        if (!entry) { res.writeHead(404, cors); res.end("unknown signup"); return; }
        entry.status = status;
        entry.updatedAt = new Date().toISOString();
        writeSignups(list);
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify(entry));
      })
      .catch((e) => { res.writeHead(e.status || 400, cors); res.end("invalid body"); });
    return;
  }
  if (url === "/live") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(publicState()));
  } else if (url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    // addresses: this PC on the venue Wi-Fi, so the dashboard can print the /inscription QR poster.
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((n) => n && n.family === "IPv4" && !n.internal)
      .map((n) => n.address);
    // startedAt / stale: the dashboard's Synchroniser card compares them to the code on disk.
    const codeUpdatedAt = Math.max(0, ...BRIDGE_CODE.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }));
    res.end(JSON.stringify({ ok: true, connected: state.connected, feed: state.source, version: state.version, port: HTTP_PORT, addresses,
                             startedAt: BRIDGE_STARTED_AT, codeUpdatedAt, stale: codeUpdatedAt > BRIDGE_STARTED_AT, pid: process.pid }));
  } else if (url === "/history") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(readHistory()));
  } else if (url === "/sessions") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(readGokartsSessions()));
  } else if (url === "/capture") {
    res.writeHead(200, { "Content-Type": "text/plain", ...cors });
    fs.createReadStream(CAPTURE).on("error", () => res.end("")).pipe(res);
  } else if (url === "/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", ...cors });
    res.write(`data: ${JSON.stringify(publicState())}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  } else if (url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(VIEWER);
  } else {
    res.writeHead(404, cors); res.end("not found");
  }
});

// Replay a captured log through the same parse/normalize/broadcast path (dev/demo only).
function replayFile(fp) {
  let lines;
  try { lines = fs.readFileSync(fp, "utf8").split(/\r?\n/).map((l) => l.split("\t").pop()).filter((l) => l && l.includes("|")); }
  catch (e) { console.log("[replay] cannot read", fp, e.message); return; }
  state.source = "replay:" + path.basename(fp);
  state.connected = true;
  let i = 0;
  console.log(`[replay] ${lines.length} messages from ${fp}`);
  const loop = process.env.APEX_REPLAY_LOOP === "1";
  const tick = () => {
    if (i >= lines.length) {
      console.log("[replay] done");
      if (loop) { i = 0; state.records = {}; state.drivers = []; state._lastRecordAt = 0; state._archived = false; bump(); setTimeout(tick, 2500); }
      return;
    }
    handleLine(lines[i++]);
    setTimeout(tick, 250);
  };
  tick();
}

server.listen(HTTP_PORT, () => {
  console.log(`MegaKart Apex Live Bridge (read-only)`);
  console.log(`  http  : http://localhost:${HTTP_PORT}/        (viewer)`);
  if (REPLAY) { console.log(`  MODE  : REPLAY ${REPLAY}`); replayFile(REPLAY); }
  else { console.log(`  feed  : ${HOST}:${FEED_PORT} (auto-discovers active session port)`); connectFeed(); }
});
