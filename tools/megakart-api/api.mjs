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
import { cloudConfigured, cloudGet } from "../apex-bridge/cloud.mjs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function send(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const read = (path) => cloudGet(`reports/${path}`);
const values = (obj) => (obj && typeof obj === "object" ? Object.values(obj) : []);
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

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
      if (req.method !== "GET") { send(res, 405, { error: "Lecture seule." }); return true; }

      if (path === "/health" || path === "/v1" || path === "/v1/health") {
        if (!configured) { send(res, 503, { ok: false, error: key.length < 24 ? "MEGAKART_API_KEY manquante." : "Clé Firebase introuvable : variable FIREBASE_SERVICE_ACCOUNT." }); return true; }
        const meta = await read("meta.json");
        send(res, 200, { ok: true, venue: meta?.venue ?? "MegaKart Fès", dataUpdatedAt: meta?.updatedAt ?? null });
        return true;
      }
      if (!configured) { send(res, 503, { error: "API non configurée sur ce serveur." }); return true; }
      if (!keyOk(req)) { send(res, 401, { error: "Clé API invalide." }); return true; }

      if (path === "/v1/today") { send(res, 200, (await read("today.json")) ?? null); return true; }
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
