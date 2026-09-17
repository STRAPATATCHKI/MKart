// One-off validator: parse captured NREC lines and prove the field decode by aggregating
// passings into a per-kart leaderboard. Run: node decode.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const cap = fs.readFileSync(path.join(dir, "out", "capture.log"), "utf8").split(/\r?\n/);

const records = [];
for (const line of cap) {
  const msg = line.split("\t").pop();
  if (!msg || !msg.startsWith("NREC|")) continue;
  records.push(msg.split("|").slice(1));
}
console.log(`parsed ${records.length} NREC records\n`);

// Decode a few for eyeballing
console.log("seq  flags     kart lapNo  total(s)  lastLap(s)  note");
for (const f of records.slice(0, 8).concat(records.slice(-3))) {
  const flags = Number(f[1]);
  const note = flags === 786434 ? "BEST" : flags === 65282 ? "START" : flags === 65285 ? "END/RESET" : "";
  console.log(
    String(f[0]).padStart(3), String(f[1]).padStart(8), String(f[2]).padStart(4),
    String(f[5]).padStart(5), (Number(f[6]) / 1e6).toFixed(3).padStart(9),
    (Number(f[7]) / 1e6).toFixed(3).padStart(10), " ", note
  );
}

// Aggregate into a leaderboard, keyed by kart/transponder (f[2]); skip session markers (kart 0)
const byKart = new Map();
for (const f of records) {
  const kart = f[2];
  if (!kart || kart === "0") continue;
  const lapNo = Number(f[5]);
  const totalUs = Number(f[6]);
  const lastUs = Number(f[7]);
  let e = byKart.get(kart);
  if (!e) { e = { kart, laps: 0, lastLapMs: null, bestLapMs: null, totalTimeMs: null }; byKart.set(kart, e); }
  if (Number.isFinite(lapNo)) e.laps = Math.max(e.laps, lapNo);
  if (totalUs > 0) e.totalTimeMs = Math.round(totalUs / 1000);
  if (lastUs > 0) { const ms = Math.round(lastUs / 1000); e.lastLapMs = ms; if (e.bestLapMs == null || ms < e.bestLapMs) e.bestLapMs = ms; }
}
const fmt = (ms) => ms == null ? "—" : (ms / 1000).toFixed(3);
console.log("\nLEADERBOARD (aggregated passings):");
console.log("pos kart laps  last     best     total");
[...byKart.values()].sort((a, b) => b.laps - a.laps).forEach((d, i) =>
  console.log(String(i + 1).padStart(3), String(d.kart).padStart(4), String(d.laps).padStart(4),
    fmt(d.lastLapMs).padStart(8), fmt(d.bestLapMs).padStart(8), fmt(d.totalTimeMs).padStart(9)));
