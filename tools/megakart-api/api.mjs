// MegaKart API — read-only access to the venue's revenue and races, for the app's backend.
//
// Served under /v1 by the desk server wherever MEGAKART_API_KEY is set - that is the MKart
// service on Render (https://mkart-7c44.onrender.com/v1/...), not the venue PC. It can also run
// on its own (server.mjs). It reads the /reports data the venue PC pushes to Firebase
// (tools/apex-bridge/cloud-reports.mjs), never writes, and can only read /reports: sign-ups,
// phone numbers and signatures are not reachable through it.
//
//   env  MEGAKART_API_KEY            the key clients send (Authorization: Bearer <key>, or x-api-key)
//        FIREBASE_SERVICE_ACCOUNT    the service-account JSON (the contents of ignore.json),
//                                    or FIREBASE_KEY_FILE, a path to it
//
// Endpoints: docs/megakart-api.md.

import crypto from "node:crypto";
import { cloudConfigured, cloudGet, cloudPut } from "../apex-bridge/cloud.mjs";
import { checkDecision } from "../../lib/disbursement-rules.mjs";
import { buildDayReport, inputFromReports } from "../../lib/day-report-rules.mjs";
import { dayReportHtml } from "../../lib/day-report-html.mjs";
import { dayReportPdf } from "../../lib/day-report-pdf.mjs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function send(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const read = (path) => cloudGet(`reports/${path}`);
const values = (obj) => (obj && typeof obj === "object" ? Object.values(obj) : []);
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/** The venue PC counts as online while its heartbeat (/reports/meta, every minute) is this recent. */
const ONLINE_WITHIN_MS = 6 * 60_000;

/** Whether the venue PC is sending, worked out here so no app has to compare clocks. */
async function pcStatus() {
  const meta = await read("meta.json");
  const seen = typeof meta?.updatedAt === "number" ? meta.updatedAt : null;
  const age = seen != null ? Math.max(0, Date.now() - seen) : null;
  return { venue: meta?.venue ?? "MegaKart Fès", pcSeenAt: seen, pcAgeSeconds: age != null ? Math.round(age / 1000) : null,
           pcOnline: age != null && age < ONLINE_WITHIN_MS, timeZone: "Africa/Casablanca" };
}

/** The venue's "today", as the venue PC last wrote it: a hosted server's own clock is UTC. */
async function today() {
  const t = await read("today.json");
  return (t && t.day) || new Date().toISOString().slice(0, 10);
}

/** ?day=, or ?from=&to=, or the venue's today. */
async function range(url) {
  const day = url.searchParams.get("day");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (day) { if (!DAY.test(day)) throw badRequest("day : AAAA-MM-JJ"); return [day, day]; }
  if (from || to) {
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) throw badRequest("from / to : AAAA-MM-JJ");
    return [from || "0000-00-00", to || "9999-99-99"];
  }
  const t = await today();
  return [t, t];
}

/**
 * The Rapport du jour (lib/day-report-rules.mjs): the day's races against the day's till, from
 * the /reports documents. Reservations are looked up from a week before, so one booked earlier
 * and cashed that day is found; Firebase keeps them 30 days, so older days have races only.
 */
async function dayReport(day) {
  const weekBefore = new Date(Date.parse(`${day}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const [races, reservations, catalog] = await Promise.all([
    read(`races.json?orderBy="day"&equalTo="${day}"`),
    read(`reservations.json?orderBy="day"&startAt="${weekBefore}"&endAt="${day}"`),
    cloudGet("catalog.json"),
  ]);
  const input = inputFromReports({ day, raceDocs: values(races), reservationDocs: values(reservations) });
  return buildDayReport({ day, ...input, offers: Array.isArray(catalog?.offers) ? catalog.offers : [] });
}

/** A small JSON body (the app's decision). */
function readJson(req, max = 8 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { reject(badRequest("Corps trop volumineux.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")); }
      catch { reject(badRequest("JSON invalide.")); }
    });
    req.on("error", reject);
  });
}

/** Every décaissement, newest first (they are few: read whole, filtered here). */
async function allDisbursements() {
  return values(await read("disbursements.json")).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** One décaissement, by its id or its code (DC-0007). */
async function oneDisbursement(key) {
  if (!ID.test(key)) throw badRequest("Identifiant invalide.");
  const byId = await read(`disbursements/${key}.json`);
  if (byId) return byId;
  return (await allDisbursements()).find((d) => d.code === key) ?? null;
}

async function byDay(node, url) {
  const [from, to] = await range(url);
  return values(await read(`${node}.json?orderBy="day"&startAt="${from}"&endAt="${to}"`));
}

/**
 * The /v1 request handler. Resolves true when it answered the request, false when the path is
 * not one of its own (the caller then carries on with its other routes).
 */
export function createApiHandler({ apiKey, log = console.log }) {
  const key = Buffer.from(String(apiKey || ""));
  const configured = key.length >= 24 && cloudConfigured();
  if (key.length < 24) log("[api] MEGAKART_API_KEY manquante ou trop courte : /v1 refuse tout");
  else if (!configured) log("[api] clé Firebase introuvable (FIREBASE_SERVICE_ACCOUNT) : /v1 refuse tout");
  else log("[api] MegaKart API active sous /v1");

  const keyOk = (req) => {
    const auth = String(req.headers.authorization || "");
    const given = Buffer.from(auth.startsWith("Bearer ") ? auth.slice(7).trim() : String(req.headers["x-api-key"] || ""));
    return given.length === key.length && crypto.timingSafeEqual(given, key);
  };

  // ---- live stream: one poller for every connected client, Firebase read once every 2 s
  const streams = new Set();
  let lastLive = null;
  let poller = null;
  const pollLive = async () => {
    try {
      const text = JSON.stringify((await read("live.json")) ?? { state: "IDLE" });
      if (text !== lastLive) {
        lastLive = text;
        for (const res of streams) res.write(`event: live\ndata: ${text}\n\n`);
      }
    } catch { /* next tick */ }
  };
  const openStream = (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(": MegaKart live\n\n");
    if (lastLive) res.write(`event: live\ndata: ${lastLive}\n\n`);
    streams.add(res);
    if (!poller) { poller = setInterval(() => { void pollLive(); }, 2000); void pollLive(); }
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      streams.delete(res);
      if (!streams.size && poller) { clearInterval(poller); poller = null; lastLive = null; }
    });
  };

  return async function handle(req, res) {
    const url = new URL(req.url || "/", "http://api.local");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path !== "/health" && path !== "/v1" && !path.startsWith("/v1/")) return false;
    try {
      // Read-only, but for one thing: the app's answer to a décaissement.
      const deciding = path.match(/^\/v1\/disbursements\/([^/]+)\/decision$/);
      if (req.method !== "GET" && !(req.method === "POST" && deciding)) { send(res, 405, { error: "Lecture seule." }); return true; }

      if (path === "/health" || path === "/v1" || path === "/v1/health") {
        if (!configured) { send(res, 503, { ok: false, error: key.length < 24 ? "MEGAKART_API_KEY manquante." : "Clé Firebase introuvable : variable FIREBASE_SERVICE_ACCOUNT." }); return true; }
        const pc = await pcStatus();
        send(res, 200, { ok: true, venue: pc.venue, dataUpdatedAt: pc.pcSeenAt, pcOnline: pc.pcOnline, pcAgeSeconds: pc.pcAgeSeconds, timeZone: pc.timeZone });
        return true;
      }
      if (!configured) { send(res, 503, { error: "API non configurée sur ce serveur." }); return true; }
      if (!keyOk(req)) { send(res, 401, { error: "Clé API invalide." }); return true; }

      if (path === "/v1/today") {
        // With the PC's heartbeat: `updatedAt` only moves when the figures do (a quiet hour leaves
        // it still), so it says nothing about whether the PC is on - `pcOnline` does.
        const [t, pc] = await Promise.all([read("today.json"), pcStatus()]);
        send(res, 200, { ...(t ?? {}), pcOnline: pc.pcOnline, pcSeenAt: pc.pcSeenAt, pcAgeSeconds: pc.pcAgeSeconds, timeZone: pc.timeZone });
        return true;
      }
      if (path === "/v1/live") { send(res, 200, (await read("live.json")) ?? { state: "IDLE" }); return true; }
      if (path === "/v1/live/stream") { openStream(req, res); return true; }
      if (path === "/v1/track") { send(res, 200, (await read("track.json")) ?? null); return true; }
      // The Garage: today's fuel (reading, races, free runs, stock), fuel per day, spare parts.
      if (path === "/v1/garage") { send(res, 200, (await read("garage.json")) ?? null); return true; }

      if (path === "/v1/days") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if ((from && !DAY.test(from)) || (to && !DAY.test(to))) throw badRequest("from / to : AAAA-MM-JJ");
        const query = from || to
          ? `days.json?orderBy="$key"&startAt="${from || "0000-00-00"}"&endAt="${to || "9999-99-99"}"`
          : `days.json?orderBy="$key"&limitToLast=31`;
        send(res, 200, values(await read(query)).sort((a, b) => a.day.localeCompare(b.day)));
        return true;
      }
      if (path === "/v1/payments") {
        send(res, 200, (await byDay("payments", url)).sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0)));
        return true;
      }
      if (path === "/v1/reservations") {
        send(res, 200, (await byDay("reservations", url)).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)));
        return true;
      }
      if (path === "/v1/races") {
        const races = (await byDay("races", url)).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
        // ?laps=0 for a light list; the laps of one race are at /v1/races/<id>.
        if (url.searchParams.get("laps") === "0") for (const r of races) for (const d of r.racers || []) delete d.lapTimesMs;
        send(res, 200, races);
        return true;
      }
      // The day report: data, a PDF to download, or the printable page. ?day=AAAA-MM-JJ, default today.
      const report = path.match(/^\/v1\/reports\/day(\.json|\.pdf|\.html)?$/);
      if (report) {
        const day = url.searchParams.get("day") || (await today());
        if (!DAY.test(day)) throw badRequest("day : AAAA-MM-JJ");
        const doc = await dayReport(day);
        if (report[1] === ".pdf") {
          const pdf = dayReportPdf(doc);
          res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": pdf.length, "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="MegaKart-rapport-${day}.pdf"` });
          res.end(pdf);
        } else if (report[1] === ".html") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(dayReportHtml(doc));
        } else {
          send(res, 200, doc);
        }
        return true;
      }
      // ---- décaissements: the list, one with its history, and the decision
      if (path === "/v1/disbursements") {
        const status = url.searchParams.get("status");
        const day = url.searchParams.get("day");
        if (day && !DAY.test(day)) throw badRequest("day : AAAA-MM-JJ");
        let list = await allDisbursements();
        if (status) list = list.filter((d) => d.status === status.toUpperCase());
        if (day) list = list.filter((d) => d.day === day);
        send(res, 200, list);
        return true;
      }
      if (deciding) {
        const checked = checkDecision(await readJson(req));
        if (checked.error) throw badRequest(checked.error);
        const doc = await oneDisbursement(decodeURIComponent(deciding[1]));
        if (!doc) { send(res, 404, { error: "Décaissement introuvable." }); return true; }
        if (doc.status !== "EN_ATTENTE") { send(res, 409, { error: `Déjà traité : ${doc.statusLabel ?? doc.status}.`, disbursement: doc }); return true; }
        if (await cloudGet(`decisions/disbursements/${doc.id}.json`)) {
          send(res, 409, { error: "Une décision est déjà en route vers le PC de la piste.", disbursement: doc });
          return true;
        }
        // Carried to the venue PC by its bridge, which applies it at the desk (within ~5 s when
        // the PC is on) and sends the request back with its new status and history.
        await cloudPut(`decisions/disbursements/${doc.id}`, { ...checked.value, decidedAt: Date.now(), via: "api" });
        const pc = await pcStatus();
        send(res, 202, {
          status: "ENVOYEE", id: doc.id, code: doc.code, decision: checked.value.decision, pcOnline: pc.pcOnline,
          message: pc.pcOnline
            ? "Décision transmise : elle est appliquée à l'accueil dans les secondes qui suivent."
            : "Décision enregistrée : elle sera appliquée dès que le PC de la piste sera allumé.",
        });
        return true;
      }
      // A photo joined to a décaissement (ticket, invoice), as the image itself.
      const photo = path.match(/^\/v1\/disbursements\/([^/]+)\/attachments\/([^/]+)$/);
      if (photo) {
        const doc = await oneDisbursement(decodeURIComponent(photo[1]));
        const attId = decodeURIComponent(photo[2]);
        if (!doc || !ID.test(attId) || !(doc.attachments || []).some((a) => a.id === attId)) {
          send(res, 404, { error: "Photo introuvable." });
          return true;
        }
        const stored = await cloudGet(`attachments/disbursements/${doc.id}/${attId}.json`);
        if (!stored || typeof stored.data !== "string") {
          send(res, 404, { error: "Photo pas encore envoyée par le PC de la piste : réessayez dans une minute." });
          return true;
        }
        const bytes = Buffer.from(stored.data, "base64");
        res.writeHead(200, { "Content-Type": stored.type || "image/jpeg", "Content-Length": bytes.length, "Cache-Control": "private, max-age=86400" });
        res.end(bytes);
        return true;
      }
      const oneDisb = path.match(/^\/v1\/disbursements\/([^/]+)$/);
      if (oneDisb) {
        const doc = await oneDisbursement(decodeURIComponent(oneDisb[1]));
        if (doc) send(res, 200, doc); else send(res, 404, { error: "Décaissement introuvable." });
        return true;
      }
      const race = path.match(/^\/v1\/races\/([^/]+)$/);
      if (race) {
        if (!ID.test(race[1])) throw badRequest("Identifiant de course invalide.");
        const doc = await read(`races/${race[1]}.json`);
        if (doc) send(res, 200, doc); else send(res, 404, { error: "Course introuvable." });
        return true;
      }
      send(res, 404, { error: "Route inconnue. Voir docs/megakart-api.md." });
      return true;
    } catch (e) {
      send(res, e.status || 502, { error: e.status ? e.message : "Firebase injoignable pour l'instant." });
      return true;
    }
  };
}
