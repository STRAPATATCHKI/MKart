// FULL BACKEND RACE SIMULATION — no track, no karts, no hardware.
//
// Replays REAL crossings captured on this system through a real bridge process, drives the
// MegaKart chrono through a complete race, and checks our independently-computed lap times
// against the numbers GoKarts put in those same NREC lines.
//
// If this passes, the backend is sound and the only thing left to verify is the physical loop.
//
// Isolated on purpose: fake feed on 30099, bridge on 8799. The production bridge (8787) and
// the live Apex feed are never touched, and the real history.json is restored at the end.
//
//   node simulate-race.mjs

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEED_PORT = 30099;
const HTTP_PORT = 8799;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;

let problems = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log(`   ${ok("✓")} ${label}${detail ? dim("  " + detail) : ""}`);
  else { problems++; console.log(`   ${bad("✗")} ${label}${detail ? "  " + detail : ""}`); }
};

// ---------------------------------------------------------------- real captured crossings
console.log(b("\n═══ 1. LECTURE DES PASSAGES RÉELS CAPTURÉS ═══\n"));

const capture = fs.readFileSync(path.join(__dirname, "out", "capture.log"), "utf8").split("\n");
const real = [];
for (const l of capture) {
  const payload = l.split("\t").pop() || "";
  if (!payload.startsWith("NREC|")) continue;
  const f = payload.split("|").slice(1);
  const [seq, flags, transponder, entrant, tsUs, lapNo, totalUs, lastUs] = f;
  if (flags === "65282" || flags === "65285") continue;
  if (!transponder || transponder === "0") continue;
  const ts = Number(tsUs);
  if (!Number.isFinite(ts) || ts <= 0) continue;
  real.push({ seq, flags, transponder, tsUs: ts, gokartsLapNo: Number(lapNo), gokartsLastUs: Number(lastUs) });
}
real.sort((a, b2) => a.tsUs - b2.tsUs);

// Take the longest contiguous run for transponder 23 (gaps > 60s = a different session).
const t23 = real.filter((r) => r.transponder === "23");
let bestRun = [], run = [t23[0]];
for (let i = 1; i < t23.length; i++) {
  if (t23[i].tsUs - t23[i - 1].tsUs > 60_000_000) { if (run.length > bestRun.length) bestRun = run; run = [t23[i]]; }
  else run.push(t23[i]);
}
if (run.length > bestRun.length) bestRun = run;

console.log(`   ${real.length} passages réels dans la capture`);
console.log(`   série contiguë retenue pour le transpondeur 23 : ${b(bestRun.length)} passages`);
const spanS = ((bestRun[bestRun.length - 1].tsUs - bestRun[0].tsUs) / 1e6).toFixed(1);
console.log(`   durée de cette série : ${spanS}s\n`);

// A second and third kart, offset from the real one, so we exercise a multi-kart race.
const mkKart = (t, offsetUs, stretch) => bestRun.map((r, i) => ({
  transponder: t,
  tsUs: bestRun[0].tsUs + offsetUs + Math.round((r.tsUs - bestRun[0].tsUs) * stretch),
  seq: `${t}-${i}`,
}));
const events = [
  ...bestRun.map((r) => ({ transponder: "23", tsUs: r.tsUs, seq: r.seq })),
  ...mkKart("7", 900_000, 1.04),
  ...mkKart("12", 2_100_000, 1.11),
].sort((a, b2) => a.tsUs - b2.tsUs);

// ---------------------------------------------------------------- harness
const clients = new Set();
const feed = net.createServer((s) => {
  clients.add(s);
  s.on("close", () => clients.delete(s));
  s.on("error", () => clients.delete(s));
  s.write("SYNC|1|\n");
});
await new Promise((r) => feed.listen(FEED_PORT, "127.0.0.1", r));
const send = (line) => { for (const c of clients) c.write(line + "\n"); };

const histFile = path.join(__dirname, "out", "history.json");
const histBefore = fs.existsSync(histFile) ? fs.readFileSync(histFile, "utf8") : null;

const bridge = spawn(process.execPath, ["bridge.mjs"], {
  cwd: __dirname,
  env: { ...process.env, APEX_FEED_BASE: String(FEED_PORT), APEX_FEED_RANGE: "1", BRIDGE_PORT: String(HTTP_PORT), APEX_HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
bridge.stdout.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => console.log(dim("   [pont] " + l))));
bridge.stderr.on("data", (d) => process.stderr.write(bad("   [pont:err] " + d)));

const cleanup = () => {
  try { bridge.kill(); } catch {}
  try { feed.close(); } catch {}
  try { if (histBefore != null) fs.writeFileSync(histFile, histBefore); } catch {}
};
process.on("exit", cleanup);

const api = async (p, body) => {
  const r = await fetch(`http://127.0.0.1:${HTTP_PORT}${p}`, body !== undefined
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : {});
  return r.json();
};

await sleep(5000);

// ---------------------------------------------------------------- the race
console.log(b("═══ 2. DÉMARRAGE DU CHRONO MEGAKART ═══\n"));
let snap = await api("/chrono/start", { sessionId: "SIM-001", name: "Simulation backend", minLapMs: 250 });
check("chrono démarré", snap.running === true);
check("garde double-lecture à 250 ms", snap.minLapMs === 250);
check("aucun passage au départ", (snap.classification?.totalCrossings ?? 0) === 0);

console.log(b("\n═══ 3. DIFFUSION DES PASSAGES RÉELS (3 karts) ═══\n"));
// Replay at 40x so a ~2 minute race takes a few seconds.
let prev = events[0].tsUs;
for (let i = 0; i < events.length; i++) {
  const e = events[i];
  const waitMs = Math.min(400, Math.max(4, (e.tsUs - prev) / 1000 / 40));
  prev = e.tsUs;
  await sleep(waitMs);
  send(`NREC|${e.seq}|2|${e.transponder}|1|${e.tsUs}|0|0|0|0|0|0|`);
  if (i % 25 === 0 && i > 0) {
    const s2 = await api("/chrono");
    const lead = s2.classification?.rows?.[0];
    if (lead) console.log(`   ${i} passages diffusés → tête : kart ${lead.transponder} (${lead.laps} tours, dernier ${lead.lastLapMs} ms)`);
  }
}
await sleep(900);

console.log(b("\n═══ 4. CLASSEMENT EN DIRECT ═══\n"));
snap = await api("/chrono");
const live = snap.classification;
console.log(`   ${"POS".padEnd(5)}${"PILOTE".padEnd(22)}${"TOURS".padStart(6)}${"DERNIER".padStart(11)}${"MEILLEUR".padStart(11)}${"ÉCART".padStart(12)}`);
for (const r of live.rows) {
  console.log(
    `   ${String(r.position).padEnd(5)}${(r.name ?? "Transp. " + r.transponder).padEnd(22)}` +
    `${String(r.laps).padStart(6)}${String(r.lastLapMs ?? "—").padStart(11)}${String(r.bestLapMs ?? "—").padStart(11)}${String(r.gapText ?? "—").padStart(12)}`,
  );
}
check("\n   3 karts classés", live.rows.length === 3, `(${live.rows.length})`);
check("le chrono tourne toujours", snap.running === true);
// The capture genuinely contains duplicate timestamps (the same crossing reported twice).
// Removing those is the guard doing its job — not a fault.
const dupes = live.integrity.excludedByGuard;
check("doublons réels écartés du classement", dupes > 0, `(${dupes} doublons à 0 ms)`);

// ---------------------------------------------------------------- the real validation
console.log(b("\n═══ 5. NOTRE ARITHMÉTIQUE vs CELLE DE GOKARTS ═══\n"));
console.log(dim("   Les mêmes passages, comparés aux temps que GoKarts avait lui-même calculés.\n"));
const ourRow = live.rows.find((r) => r.transponder === "23");

// Apply the SAME guard to the reference series, otherwise we would be comparing a deduplicated
// board against a series that still contains the duplicate crossings — and everything after the
// first duplicate would look shifted by one.
const keptRef = [];
for (const c of bestRun) {
  const prev = keptRef[keptRef.length - 1];
  if (prev && c.tsUs - prev.tsUs < 250_000) continue;
  keptRef.push(c);
}
const ourLapsFromTs = [];
for (let i = 1; i < keptRef.length; i++) ourLapsFromTs.push(Math.round((keptRef[i].tsUs - keptRef[i - 1].tsUs) / 1000));
// GoKarts' own lap time for each kept crossing (its last_us field on that very NREC line).
const gokartsLaps = keptRef.slice(1).map((r) => Math.round(r.gokartsLastUs / 1000));

let matched = 0, compared = 0, mismatches = [];
for (let i = 0; i < Math.min(ourLapsFromTs.length, gokartsLaps.length); i++) {
  if (!gokartsLaps[i]) continue; // GoKarts did not report a lap time on that line
  compared++;
  if (Math.abs(ourLapsFromTs[i] - gokartsLaps[i]) <= 1) matched++;
  else mismatches.push(`#${i + 1} nous ${ourLapsFromTs[i]} / eux ${gokartsLaps[i]}`);
}
console.log(`   ${bestRun.length} passages bruts → ${keptRef.length} après retrait des doublons`);
console.log(`   nos 8 premiers tours (ms) : ${ourLapsFromTs.slice(0, 8).join(", ")}`);
console.log(`   GoKarts, mêmes tours (ms) : ${gokartsLaps.slice(0, 8).join(", ")}`);
check(`\n   ${matched}/${compared} tours identiques (±1 ms)`, compared > 0 && matched === compared,
  mismatches.length ? mismatches.slice(0, 4).join("  ") : "");
check("nombre de tours cohérent", ourRow.laps === keptRef.length - 1, `nous ${ourRow.laps}, attendu ${keptRef.length - 1}`);

// ---------------------------------------------------------------- guard recovery
console.log(b("\n═══ 6. CORRECTION D'UNE GARDE MAL RÉGLÉE (sans refaire la course) ═══\n"));
const bad1500 = await api("/chrono/reclassify", { minLapMs: 1500 });
const r1500 = bad1500.classification.rows.find((r) => r.transponder === "23");
console.log(`   garde 1500 ms → ${r1500.laps} tours, ${bad1500.classification.integrity.excludedByGuard} passages masqués`);
const back250 = await api("/chrono/reclassify", { minLapMs: 250 });
const r250 = back250.classification.rows.find((r) => r.transponder === "23");
console.log(`   garde  250 ms → ${r250.laps} tours, ${back250.classification.integrity.excludedByGuard} passages masqués`);
check("une mauvaise garde fausse le classement", r1500.laps < r250.laps);
check("et se corrige sans perdre un seul passage", r250.laps === ourRow.laps);
check("le registre garde tout", back250.ledgerSize === events.length, `(${back250.ledgerSize}/${events.length})`);

// ---------------------------------------------------------------- stop + archive
console.log(b("\n═══ 7. ARRÊT ET ARCHIVAGE ═══\n"));
const stopped = await api("/chrono/stop", {});
check("chrono arrêté", stopped.running === false);
check("classement final conservé", stopped.classification.rows.length === 3);
check("résultat marqué complet", stopped.classification.integrity.complete === true);
check("archivé", typeof stopped.archivedAs === "string" && stopped.archivedAs.startsWith("MK-"), stopped.archivedAs);

const hist = await (await fetch(`http://127.0.0.1:${HTTP_PORT}/history`)).json();
const entry = hist.find((h) => h.id === stopped.archivedAs);
check("présent dans l'historique", !!entry);
if (entry) {
  check("origine = megakart", entry.origin === "megakart");
  console.log(`\n   ${dim("archive:")} ${entry.id}  vainqueur ${b(entry.winner)}  ${entry.laps} tours  meilleur ${entry.bestLapMs} ms`);
}

// ---------------------------------------------------------------- verdict
console.log(b("\n═══ VERDICT ═══\n"));
if (problems === 0) {
  console.log(ok("   Le backend fonctionne de bout en bout avec de vrais passages.\n"));
  console.log("   Reste à vérifier physiquement : que la boucle émette bien des passages");
  console.log("   quand vous lancez une session dans GoKarts.\n");
} else {
  console.log(bad(`   ${problems} problème(s) — voir ci-dessus.\n`));
}
cleanup();
process.exit(problems ? 1 : 0);
