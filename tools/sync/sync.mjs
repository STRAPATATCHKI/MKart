// VENUE → RENDER SYNC.
//
// Pushes what the venue produces up to the cloud, and receives commands back on the SAME
// response. That shape matters: the venue never accepts an inbound connection, so it needs no
// port forwarding, no firewall exception and no websocket to keep alive behind the router.
//
// LOCAL STAYS THE SOURCE OF TRUTH ON SITE. The counter, the big screen and the chrono all read
// the venue PC and keep working when the line is down; Render is a mirror for remote viewing
// and history. If this module fails completely, nothing on site stops. That is deliberate —
// an internet outage must never stop a till on a Saturday.
//
// SECURITY, and why each rule exists:
//   - Bearer token from the environment, never a file in the repo, never logged.
//   - HTTPS enforced, except to localhost for tests. A bearer token over plain HTTP on a venue
//     LAN is readable by anyone on that Wi-Fi.
//   - Commands from the server are checked against an ALLOW-LIST. A spoofed or compromised
//     server must not be able to make the venue PC do something arbitrary; it may only choose
//     from verbs we already implement.
//   - Responses are size-capped and never evaluated.
//   - Sync failures are isolated: they can never throw into the feed reader.

import { createOutbox } from "./outbox.mjs";

const MAX_RESPONSE_BYTES = 512 * 1024;

/**
 * The only instructions the cloud may issue. Anything else is logged and ignored.
 * Note what is absent and always will be: nothing touching kart power, speed, DeHaardt or the
 * start lights. Those are not remotely commandable by design, not by omission.
 */
const ALLOWED_COMMANDS = new Set([
  "chrono.start",
  "chrono.stop",
  "chrono.reclassify",
  "reservation.upsert",
  "reservation.status",
  "ping",
]);

export function createSync({
  cloudUrl,
  token,
  venueId,
  dir,
  intervalMs = 500,
  onCommand,
  log = console.log,
}) {
  if (!cloudUrl || !token) {
    log("[sync] désactivé : MEGAKART_CLOUD_URL ou MEGAKART_VENUE_TOKEN absent.");
    return { push: () => {}, stats: () => ({ enabled: false }), stop: () => {}, start: () => {} };
  }

  const base = String(cloudUrl).replace(/\/+$/, "");
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(base);
  if (!base.startsWith("https://") && !isLocal) {
    // Refuse rather than quietly send a bearer token in clear text.
    log("[sync] REFUS : MEGAKART_CLOUD_URL doit être en https:// (http n'est toléré que vers localhost).");
    return { push: () => {}, stats: () => ({ enabled: false, error: "https requis" }), stop: () => {}, start: () => {} };
  }

  const outbox = createOutbox({ dir });
  let timer = null;
  let inFlight = false;
  let failures = 0;
  let lastOk = null;
  let lastError = null;
  let stopped = false;

  /** Record an event for eventual delivery. Never throws into the caller. */
  function push(kind, payload) {
    try { outbox.push(kind, payload); }
    catch (e) { log("[sync] événement non enregistré:", e.message); }
  }

  /** Exponential backoff, capped. A venue offline for an hour must not hammer the link. */
  function delay() {
    if (failures === 0) return intervalMs;
    return Math.min(30_000, intervalMs * Math.pow(2, Math.min(failures, 6)));
  }

  async function tick() {
    if (stopped || inFlight) return schedule();
    const batch = outbox.pending(200);

    // Still call with an empty batch, but slowly: that is how commands arrive when the venue
    // has nothing to report.
    if (batch.length === 0 && failures === 0 && Date.now() - (lastOk ?? 0) < 3000) return schedule();

    inFlight = true;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15_000);

    try {
      const res = await fetch(`${base}/api/venue/sync`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Venue-Id": venueId,
        },
        body: JSON.stringify({
          venueId,
          cursor: outbox.stats().acked,
          events: batch,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        // Not transient. Backing off forever is better than retrying a rejected credential.
        failures += 1;
        lastError = `authentification refusée (${res.status})`;
        log("[sync] " + lastError + " — vérifiez MEGAKART_VENUE_TOKEN.");
        return;
      }
      if (!res.ok) {
        failures += 1;
        lastError = `serveur ${res.status}`;
        return;
      }

      const text = await res.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        failures += 1;
        lastError = "réponse trop volumineuse";
        return;
      }
      let body;
      try { body = JSON.parse(text); } catch { failures += 1; lastError = "réponse illisible"; return; }

      if (Number.isFinite(body?.acked)) outbox.ack(body.acked);
      failures = 0;
      lastError = null;
      lastOk = Date.now();

      // Commands ride the response — no inbound connection is ever accepted.
      const commands = Array.isArray(body?.commands) ? body.commands.slice(0, 50) : [];
      for (const cmd of commands) {
        const verb = typeof cmd?.verb === "string" ? cmd.verb : "";
        if (!ALLOWED_COMMANDS.has(verb)) {
          log(`[sync] commande refusée (hors liste blanche) : ${JSON.stringify(verb).slice(0, 60)}`);
          continue;
        }
        try { await onCommand?.(verb, cmd.payload ?? {}, cmd.id ?? null); }
        catch (e) { log(`[sync] commande ${verb} a échoué:`, e.message); }
      }

      if (outbox.stats().backlog === 0) {
        const dropped = outbox.compact();
        if (dropped > 0) log(`[sync] ${dropped} événement(s) acquittés purgés du journal.`);
      }
    } catch (e) {
      failures += 1;
      // A DNS failure or a dropped line is expected, not exceptional. Log the first one, then
      // stay quiet so an overnight outage does not fill the disk with identical lines.
      lastError = e.name === "AbortError" ? "délai dépassé" : e.message;
      if (failures === 1) log("[sync] hors ligne :", lastError, "— les événements sont conservés localement.");
    } finally {
      clearTimeout(timeout);
      inFlight = false;
      schedule();
    }
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void tick(); }, delay());
  }

  function start() {
    stopped = false;
    log(`[sync] actif → ${base} (venue ${venueId})`);
    schedule();
  }
  function stop() { stopped = true; clearTimeout(timer); }

  function stats() {
    const s = outbox.stats();
    return {
      enabled: true,
      cloudUrl: base,
      venueId,
      online: failures === 0 && lastOk != null,
      backlog: s.backlog,
      seq: s.seq,
      acked: s.acked,
      failures,
      lastOk: lastOk ? new Date(lastOk).toISOString() : null,
      lastError,
    };
  }

  return { push, start, stop, stats };
}
