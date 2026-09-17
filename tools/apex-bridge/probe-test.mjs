// DECISIVE TEST INSTRUMENT — "does the feed emit passings while GoKarts is idle?"
//
// Run this, leave GoKarts open with NO session armed, and walk one known transponder across
// the timing loop. Every raw line the bridge receives is decoded here field by field, so we
// can see exactly which values arrive FROM UPSTREAM and which MegaKart must compute itself.
//
// It reads tools/apex-bridge/out/capture.log — the file bridge.mjs already appends every feed
// line to. It deliberately does NOT open its own TCP connection to the feed: if the feed only
// accepts one client, a second connection could steal the bridge's socket and stop live timing
// mid-race. Watching the log is strictly read-only and cannot disturb anything.
//
// Nothing here touches COM3, DeHaardt, kart power, start lights or any control system.
//
//   node probe-test.mjs            (watch until Ctrl+C)
//   node probe-test.mjs --seconds 120

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE = path.join(__dirname, "out", "capture.log");

const argSeconds = (() => {
  const i = process.argv.indexOf("--seconds");
  return i > -1 ? Number(process.argv[i + 1]) || 0 : 0;
})();

// NREC | seq | flags | transponder | ? | ts_us | lapNo | total_us | last_us | s1 | s2 | s3 | name?
const NREC_FIELDS = [
  "seq", "flags", "transponder", "unknown4", "ts_us",
  "lapNo", "total_us", "last_us", "s1", "s2", "s3", "name",
];

const FLAG_NAMES = {
  "2": "passage normal",
  "786434": "MEILLEUR TOUR",
  "65282": "MARQUEUR début de session (GoKarts)",
  "65285": "MARQUEUR fin de session (GoKarts)",
};

const stats = {
  started: new Date(),
  lines: 0,
  byTag: Object.create(null),
  nrec: 0,
  passings: 0,        // real crossings (a transponder, not a session marker)
  markers: 0,
  transponders: new Set(),
  firstPassingAt: null,
};

const us = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${(n / 1000).toFixed(3)} ms` : null;
};

function decodeNrec(fields) {
  const out = [];
  for (let i = 0; i < NREC_FIELDS.length; i++) {
    const name = NREC_FIELDS[i];
    const raw = fields[i];
    if (raw === undefined) continue;
    const empty = raw === "" || raw === "0";
    let note = "";
    if (name === "flags") note = FLAG_NAMES[raw] ? `  <- ${FLAG_NAMES[raw]}` : "  <- inconnu";
    if (name === "ts_us" && !empty) note = "  <- horodatage matériel (microsecondes)";
    if ((name === "total_us" || name === "last_us") && !empty) note = `  = ${us(raw)}  <- CALCULÉ PAR GOKARTS`;
    if (name === "lapNo" && !empty) note = "  <- CALCULÉ PAR GOKARTS";
    out.push(
      `      ${String(i).padStart(2)} ${name.padEnd(12)} ${String(raw).padEnd(22)}` +
      `${empty ? "(vide/zéro — PAS fourni en amont)" : ""}${note}`,
    );
  }
  return out.join("\n");
}

function render(ts, line) {
  stats.lines++;
  const parts = line.split("|");
  const tag = parts[0];
  stats.byTag[tag] = (stats.byTag[tag] || 0) + 1;

  // SYNC is a 10s heartbeat; printing it would bury the signal.
  if (tag === "SYNC") return;

  const clock = ts.slice(11, 23);

  if (tag !== "NREC" && tag !== "UREC") {
    console.log(`\n[${clock}] ${tag}  ${line}`);
    return;
  }

  stats.nrec++;
  const f = parts.slice(1);
  const flags = f[1];
  const transponder = f[2];
  const isMarker = flags === "65282" || flags === "65285";

  if (isMarker) {
    stats.markers++;
    console.log(
      `\n[${clock}] ${tag}  ===== ${FLAG_NAMES[flags]} =====\n` +
      `      (GoKarts a ouvert/fermé une session — ce n'est PAS un passage de kart)\n` +
      `      brut: ${line}`,
    );
    return;
  }

  stats.passings++;
  if (!stats.firstPassingAt) stats.firstPassingAt = new Date();
  if (transponder) stats.transponders.add(transponder);

  console.log(
    `\n[${clock}] ${tag}  *** PASSAGE DÉTECTÉ ***  transpondeur ${transponder}\n` +
    `      brut: ${line}\n` +
    decodeNrec(f),
  );
}

function summary() {
  const secs = Math.round((Date.now() - stats.started.getTime()) / 1000);
  console.log(`\n${"=".repeat(78)}`);
  console.log(`RÉSULTAT DU TEST — ${secs}s d'écoute`);
  console.log("=".repeat(78));
  console.log(`  lignes reçues      : ${stats.lines}`);
  console.log(`  par type           : ${Object.entries(stats.byTag).map(([k, v]) => `${k}=${v}`).join("  ") || "(aucune)"}`);
  console.log(`  passages réels     : ${stats.passings}`);
  console.log(`  marqueurs GoKarts  : ${stats.markers}`);
  console.log(`  transpondeurs vus  : ${[...stats.transponders].join(", ") || "(aucun)"}`);
  console.log("");
  if (stats.passings > 0 && stats.markers === 0) {
    console.log("  VERDICT : des passages arrivent SANS marqueur de session GoKarts.");
    console.log("            => MegaKart peut posséder sa propre fenêtre de chrono.");
  } else if (stats.passings > 0) {
    console.log("  VERDICT : des passages sont arrivés, MAIS des marqueurs de session aussi —");
    console.log("            GoKarts avait probablement une session armée. Refaire le test à vide.");
  } else {
    console.log("  VERDICT : AUCUN passage reçu pendant l'écoute.");
    console.log("            Soit le transpondeur n'a pas coupé la boucle, soit le flux est");
    console.log("            conditionné par une session armée dans GoKarts.");
  }
  console.log("=".repeat(78));
}

// ------------------------------------------------------------------ tail loop

if (!fs.existsSync(CAPTURE)) {
  console.error(`capture.log introuvable : ${CAPTURE}\nLe pont (bridge.mjs) doit tourner.`);
  process.exit(1);
}

console.log("=".repeat(78));
console.log("MEGAKART — TEST DÉCISIF : le flux émet-il des passages sans session GoKarts ?");
console.log("=".repeat(78));
console.log("  1. GoKarts ouvert, AUCUNE session armée.");
console.log("  2. Ce probe écoute (lecture seule du journal du pont).");
console.log("  3. Passez UN transpondeur connu sur la boucle.");
console.log("  4. Recommencez 2 fois pour confirmer.");
console.log("");
console.log("  Ctrl+C pour arrêter et voir le verdict.");
console.log("=".repeat(78));

// Start from the CURRENT end of file: we only want what happens during the test.
let offset = fs.statSync(CAPTURE).size;
let carry = "";

const tick = () => {
  let size;
  try { size = fs.statSync(CAPTURE).size; } catch { return; }
  if (size < offset) { offset = 0; carry = ""; } // log rotated/truncated
  if (size === offset) return;

  const stream = fs.createReadStream(CAPTURE, { start: offset, end: size - 1, encoding: "utf8" });
  let chunk = "";
  stream.on("data", (d) => { chunk += d; });
  stream.on("end", () => {
    offset = size;
    const text = carry + chunk;
    const lines = text.split("\n");
    carry = lines.pop() ?? "";
    for (const l of lines) {
      if (!l.trim()) continue;
      const tabIdx = l.indexOf("\t");
      if (tabIdx < 0) continue;
      render(l.slice(0, tabIdx), l.slice(tabIdx + 1));
    }
  });
};

const timer = setInterval(tick, 250);

let lastHeartbeat = Date.now();
const heartbeat = setInterval(() => {
  if (Date.now() - lastHeartbeat < 9500) return;
  lastHeartbeat = Date.now();
  if (stats.passings === 0) {
    process.stdout.write(
      `\r  … en écoute — ${stats.lines} lignes, ${stats.passings} passage(s). ` +
      `Passez le transpondeur sur la boucle.   `,
    );
  }
}, 1000);

const stop = () => {
  clearInterval(timer);
  clearInterval(heartbeat);
  tick();
  setTimeout(() => { summary(); process.exit(0); }, 400);
};

process.on("SIGINT", stop);
if (argSeconds > 0) setTimeout(stop, argSeconds * 1000);
