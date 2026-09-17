// Tests for the venue → Render sync. Run: node sync.test.mjs
//
// Covers the properties that decide whether a race survives a bad connection, and the
// security rules that decide what a hostile server can make the venue PC do.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createOutbox } from "./outbox.mjs";
import { createSync } from "./sync.mjs";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "mk-sync-"));

// ───────────────────────────────────────────────────────────── outbox
console.log("\n— registre de sortie —");
{
  const dir = tmpdir();
  const o = createOutbox({ dir });
  eq("numéros monotones", [o.push("a", {}), o.push("b", {}), o.push("c", {})], [1, 2, 3]);
  eq("tout en attente au départ", o.pending().length, 3);
  o.ack(2);
  eq("acquitter avance le curseur", o.pending().map((e) => e.seq), [3]);
  o.ack(1);
  eq("un acquittement ne recule jamais", o.stats().acked, 2);

  // The property that saves a race: reopening must resume, not restart.
  const o2 = createOutbox({ dir });
  eq("reprise après redémarrage", o2.stats(), { seq: 3, acked: 2, backlog: 1 });
  eq("ne renvoie que le non-acquitté", o2.pending().map((e) => e.seq), [3]);
}

// ───────────────────────────────────────────────────────────── refus de configuration
console.log("\n— refus de configuration —");
{
  const s = createSync({ cloudUrl: "http://example.com", token: "t", venueId: "fes", dir: tmpdir() });
  eq("http distant refusé (jeton en clair)", s.stats().enabled, false);
}
{
  const s = createSync({ cloudUrl: "https://example.com", token: "", venueId: "fes", dir: tmpdir() });
  eq("sans jeton, sync désactivée", s.stats().enabled, false);
}
{
  const s = createSync({ cloudUrl: "http://127.0.0.1:1", token: "t", venueId: "fes", dir: tmpdir() });
  eq("http vers localhost toléré (tests)", s.stats().enabled, true);
  s.stop();
}

// ───────────────────────────────────────────────────────────── contre un faux Render
console.log("\n— contre un faux serveur Render —");
const received = [];
let mode = "ok";
let seenAuth = null;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    seenAuth = req.headers.authorization || null;
    let parsed = {};
    try { parsed = JSON.parse(body || "{}"); } catch { /* ignore */ }
    if (Array.isArray(parsed.events)) received.push(...parsed.events);

    if (mode === "500") { res.writeHead(500); res.end("boom"); return; }
    if (mode === "401") { res.writeHead(401); res.end("nope"); return; }

    const maxSeq = parsed.events?.length ? parsed.events[parsed.events.length - 1].seq : parsed.cursor;
    const payload = { acked: maxSeq, commands: [] };
    if (mode === "command") payload.commands = [{ verb: "chrono.start", payload: { sessionId: "S1" }, id: "c1" }];
    if (mode === "hostile") {
      payload.commands = [
        { verb: "shell.exec", payload: { cmd: "rm -rf /" }, id: "h1" },
        { verb: "kart.shutdown", payload: { kart: 3 }, id: "h2" },
        { verb: "chrono.stop", payload: {}, id: "h3" },
      ];
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;

{
  const dir = tmpdir();
  const seen = [];
  const s = createSync({
    cloudUrl: url, token: "secret-token", venueId: "fes", dir, intervalMs: 50,
    onCommand: (verb, payload) => { seen.push(verb); },
    log: () => {},
  });
  s.start();
  s.push("chrono.result", { laps: 12 });
  s.push("reservation.created", { code: "MK-1234" });
  await sleep(500);

  eq("les événements arrivent", received.map((e) => e.kind), ["chrono.result", "reservation.created"]);
  eq("jeton envoyé en Bearer", seenAuth, "Bearer secret-token");
  eq("plus de retard après acquittement", s.stats().backlog, 0);
  eq("marqué en ligne", s.stats().online, true);

  // A hostile server must not be able to reach beyond the allow-list.
  mode = "hostile";
  s.push("ping", {});
  await sleep(400);
  eq("commandes hors liste blanche ignorées", seen.includes("shell.exec"), false);
  eq("arrêt kart jamais exécuté", seen.includes("kart.shutdown"), false);
  eq("commande légitime du même lot exécutée", seen.includes("chrono.stop"), true);

  mode = "ok";
  s.stop();
}

// ───────────────────────────────────────────────────────────── panne réseau
console.log("\n— panne réseau —");
{
  const dir = tmpdir();
  received.length = 0;
  mode = "500";
  const s = createSync({ cloudUrl: url, token: "t", venueId: "fes", dir, intervalMs: 40, log: () => {} });
  s.start();
  s.push("chrono.result", { laps: 5 });
  s.push("chrono.result", { laps: 6 });
  await sleep(300);

  eq("rien acquitté pendant la panne", s.stats().acked, 0);
  eq("les événements sont conservés", s.stats().backlog, 2);
  eq("marqué hors ligne", s.stats().online, false);

  // The link returns: everything replays, nothing was lost.
  mode = "ok";
  await sleep(900);
  eq("rejoué au retour du réseau", s.stats().backlog, 0);
  eq("les deux courses sont arrivées", received.filter((e) => e.kind === "chrono.result").length >= 2, true);
  s.stop();
}

// ───────────────────────────────────────────────────────────── jeton refusé
console.log("\n— jeton refusé —");
{
  const dir = tmpdir();
  mode = "401";
  const s = createSync({ cloudUrl: url, token: "mauvais", venueId: "fes", dir, intervalMs: 40, log: () => {} });
  s.start();
  s.push("ping", {});
  await sleep(300);
  eq("rien acquitté avec un jeton invalide", s.stats().acked, 0);
  eq("erreur signalée", /authentification/.test(s.stats().lastError ?? ""), true);
  eq("événement conservé pour plus tard", s.stats().backlog, 1);
  s.stop();
  mode = "ok";
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
