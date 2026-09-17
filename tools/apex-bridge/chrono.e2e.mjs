// End-to-end proof of the MegaKart chrono, against a REAL bridge process.
//
// Spins up a fake Apex feed on a spare port, starts a second bridge instance pointed at it
// (its own HTTP port, so the production bridge on 8787 is never touched), then drives the
// full cycle: start -> passings -> live classification -> stop -> archived result.
//
//   node chrono.e2e.mjs

import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEED_PORT = 30099;   // outside the 30001-30012 range the bridge auto-scans
const HTTP_PORT = 8799;    // never 8787
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const api = async (p, body) => {
  const res = await fetch(`http://127.0.0.1:${HTTP_PORT}${p}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : {});
  return res.json();
};

// ---------------------------------------------------------------- fake feed
const clients = new Set();
const feed = net.createServer((sock) => {
  clients.add(sock);
  sock.on("close", () => clients.delete(sock));
  sock.on("error", () => clients.delete(sock));
  sock.write("SYNC|1|\n"); // the bridge's discovery probe looks for a known tag
});
await new Promise((r) => feed.listen(FEED_PORT, "127.0.0.1", r));
const send = (line) => { for (const c of clients) c.write(line + "\n"); };
console.log(`fake feed listening on ${FEED_PORT}`);

// ---------------------------------------------------------------- bridge under test
const outDir = path.join(__dirname, "out");
const histFile = path.join(outDir, "history.json");
const histBefore = fs.existsSync(histFile) ? fs.readFileSync(histFile, "utf8") : null;

const bridge = spawn(process.execPath, ["bridge.mjs"], {
  cwd: __dirname,
  // discover() scans APEX_FEED_BASE..+RANGE — APEX_FEED_PORT alone is not enough to point it here.
  env: {
    ...process.env,
    APEX_FEED_BASE: String(FEED_PORT),
    APEX_FEED_RANGE: "1",
    APEX_FEED_PORT: String(FEED_PORT),
    BRIDGE_PORT: String(HTTP_PORT),
    APEX_HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
bridge.stdout.on("data", (d) => process.stdout.write(`   [bridge] ${d}`));
bridge.stderr.on("data", (d) => process.stderr.write(`   [bridge:err] ${d}`));

const cleanup = () => {
  try { bridge.kill(); } catch {}
  try { feed.close(); } catch {}
  // Never let a test leave fake races in the real history file.
  try { if (histBefore != null) fs.writeFileSync(histFile, histBefore); } catch {}
};
process.on("exit", cleanup);

await sleep(5000);

const T0 = 3998700000000000;
const at = (sec) => T0 + sec * 1_000_000;

try {
  // ---- before start: passings must be ignored ----
  send(`NREC|1|2|23|1|${at(0)}|1|0|0|0|0|0|`);
  await sleep(500);
  let snap = await api("/chrono");
  eq("idle chrono is not running", snap.running, false);

  // ---- start our window ----
  snap = await api("/chrono/start", { sessionId: "MK-E2E", name: "Test E2E", minLapMs: 0 });
  eq("chrono started", snap.running, true);
  eq("session id recorded", snap.sessionId, "MK-E2E");

  // ---- a real race: two karts ----
  // kart 23: crossings at 10, 40, 68  -> 2 laps, last 28s, best 28s
  // kart 77: crossings at 12, 45, 75  -> 2 laps, last 30s, best 30s (behind on time)
  for (const [t, kart] of [[10, "23"], [12, "77"], [40, "23"], [45, "77"], [68, "23"], [75, "77"]]) {
    send(`NREC|9|2|${kart}|1|${at(t)}|0|0|0|0|0|0|`);
    await sleep(120);
  }
  // GoKarts' own markers must NOT close our window
  send(`NREC|9|65285|0|0|${at(80)}|0|0|0|0|0|0|`);
  await sleep(600);

  snap = await api("/chrono");
  const rows = snap.classification.rows;
  eq("two pilots counted", rows.length, 2);
  eq("leader is transponder 23", rows[0].transponder, "23");
  eq("leader has 2 laps", rows[0].laps, 2);
  eq("leader last lap 28.000s", rows[0].lastLapMs, 28000);
  eq("second is 77", rows[1].transponder, "77");
  eq("gap to leader is +7.000", rows[1].gapText, "+7.000");
  eq("still running past GoKarts end marker", snap.running, true);
  eq("upstream marker noted as context", snap.upstreamMarkers.length, 1);

  // ---- one more lap AFTER GoKarts said the session ended ----
  send(`NREC|9|2|23|1|${at(95)}|0|0|0|0|0|0|`);
  await sleep(500);
  snap = await api("/chrono");
  eq("lap counted after upstream end marker", snap.classification.rows[0].laps, 3);

  // ---- stop and archive ----
  const stopped = await api("/chrono/stop", {});
  eq("chrono stopped", stopped.running, false);
  eq("final classification kept", stopped.classification.rows[0].laps, 3);
  eq("archived with an id", typeof stopped.archivedAs === "string" && stopped.archivedAs.startsWith("MK-"), true);
  eq("result marked complete", stopped.classification.integrity.complete, true);

  const hist = await (await fetch(`http://127.0.0.1:${HTTP_PORT}/history`)).json();
  const mine = hist.find((h) => h.id === stopped.archivedAs);
  eq("appears in /history", !!mine, true);
  eq("tagged as megakart-origin", mine.origin, "megakart");
  // The winner is stored under the RESOLVED driver name when the roster or the active session
  // knows the transponder, and falls back to the bare transponder when nobody does. Either is
  // correct; what matters is that a row is never anonymous when we do know who it is.
  const winnerRow = mine.drivers[0];
  eq("winner row is transponder 23", winnerRow.transponder, "23");
  eq("winner recorded by resolved identity", mine.winner, winnerRow.name ?? winnerRow.transponder);
} catch (e) {
  fail++;
  console.log("FAIL  threw:", e.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
cleanup();
process.exit(fail ? 1 : 0);
