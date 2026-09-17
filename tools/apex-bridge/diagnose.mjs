// LIVE HARDWARE + TIMING DIAGNOSTIC — strictly read-only.
//
// Answers, in one screen, the question an operator actually has when nothing appears on the
// dashboard: "where does the chain stop?" It walks the whole path from the detection loop to
// the browser and shows which link is broken.
//
//   boucle (FTDI/COM3) → GoKarts → GoServer → port de flux → pont → tableau de bord
//
// It NEVER opens COM3 (GoKarts holds it exclusively — taking it would stop live timing), never
// writes to Apex, never touches Firebird, and never talks to kart power or start lights.
// Everything here is either a Windows inventory query or an HTTP GET against our own bridge.
//
//   node diagnose.mjs            live, refreshes every 3s (Ctrl+C to stop)
//   node diagnose.mjs --once     print once and exit

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = process.env.BRIDGE_URL || "http://localhost:8787";
const ONCE = process.argv.includes("--once");

const C = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
};

const ps = (script) =>
  new Promise((resolve) => {
    execFile("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => resolve(err ? "" : String(stdout).trim()));
  });

const getJson = async (url) => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

function line(state, label, detail) {
  const mark = state === "ok" ? C.green("●") : state === "warn" ? C.amber("●") : C.red("●");
  return `  ${mark} ${label.padEnd(34)}${detail}`;
}

async function collect() {
  const [pnp, procs, ports, gkCfg] = await Promise.all([
    // The detection loop's USB-serial adapter. Presence + driver state only; the port is
    // never opened.
    //
    // `-Present` matters: Windows keeps ghost entries for every USB port the adapter was ever
    // plugged into. This machine has a stale "COM4" record for the same serial (B40129T6)
    // alongside the live COM3 one. Without the filter the diagnostic reports a phantom fault.
    ps(`Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -match 'VID_0403' -and $_.Class -eq 'Ports' } |
        ForEach-Object { "$($_.Status)|$($_.Class)|$($_.FriendlyName)" }`),
    ps(`Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match '^(GoKarts|GoServer|GoTV|firebird)$' } |
        ForEach-Object { "$($_.ProcessName)|$($_.Id)|$([math]::Round($_.WorkingSet64/1MB))" }`),
    ps(`Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -in 3050,3074,9120,9122 -or ($_.LocalPort -ge 30000 -and $_.LocalPort -le 30020) } |
        Select-Object -ExpandProperty LocalPort -Unique |
        ForEach-Object { "$_" }`),
    Promise.resolve(
      (() => {
        try {
          const xml = fs.readFileSync("C:\\ApexTiming\\GoKarts\\config.xml", "utf8");
          const com = xml.match(/<COM[^>]*>(\d+)<\/COM>/)?.[1] ?? null;
          const timing = xml.match(/<TIMING[^>]*>(\d+)<\/TIMING>/)?.[1] ?? null;
          return { com, timing };
        } catch { return { com: null, timing: null }; }
      })(),
    ),
  ]);

  const health = await getJson(`${BRIDGE}/health`);
  const live = health ? await getJson(`${BRIDGE}/live`) : null;

  return {
    adapters: pnp ? pnp.split(/\r?\n/).filter(Boolean).map((l) => l.split("|")) : [],
    procs: procs ? procs.split(/\r?\n/).filter(Boolean).map((l) => l.split("|")) : [],
    ports: ports ? ports.split(/\r?\n/).filter(Boolean).map(Number) : [],
    gkCfg,
    health,
    live,
  };
}

function render(d) {
  const out = [];
  const now = new Date().toLocaleTimeString("fr-FR");
  out.push(C.b(`\n  MEGAKART — DIAGNOSTIC DE LA CHAÎNE DE CHRONOMÉTRAGE`) + C.dim(`      ${now}`));
  out.push(C.dim("  " + "─".repeat(74)));

  // 1. the loop
  const ftdi = d.adapters.find((a) => a[1] === "Ports") || d.adapters[0];
  const liveCom = ftdi ? (ftdi[2].match(/COM(\d+)/)?.[1] ?? null) : null;
  if (!ftdi) out.push(line("bad", "1. Boucle de détection", "aucun adaptateur FTDI présent sur cette machine"));
  else if (ftdi[0] === "OK") out.push(line("ok", "1. Boucle de détection", `${ftdi[2]} ${C.dim("(présent · port non ouvert par nous)")}`));
  else out.push(line("bad", "1. Boucle de détection", `${ftdi[2]} — état ${ftdi[0]}`));

  // 2. GoKarts config — and the check that actually bites: does the configured port still
  // match the port the adapter enumerated on? A replug can move it, and GoKarts would then
  // be listening to a port that no longer exists, with no obvious symptom but silence.
  const com = d.gkCfg.com;
  if (!com) out.push(line("warn", "2. GoKarts → port série", "config.xml illisible"));
  else if (liveCom && liveCom !== com) {
    out.push(line("bad", "2. GoKarts → port série", C.red(`configuré COM${com} mais l'adaptateur est sur COM${liveCom}`)));
    out.push(C.dim("      GoKarts écoute un port qui n'existe plus — aucun passage ne sera lu."));
  } else {
    out.push(line("ok", "2. GoKarts → port série", `COM${com} ${C.dim(`· concorde · chronométrage ${d.gkCfg.timing === "1" ? "activé" : "désactivé"}`)}`));
  }

  // 3. processes
  const need = ["GoKarts", "GoServer", "firebird"];
  const running = new Map(d.procs.map((p) => [p[0], p]));
  for (const n of need) {
    const p = running.get(n);
    out.push(p
      ? line("ok", `3. Processus ${n}`, C.dim(`pid ${p[1]} · ${p[2]} Mo`))
      : line("bad", `3. Processus ${n}`, "arrêté"));
  }

  // 4. feed port — the decisive link
  const feedPorts = d.ports.filter((p) => p >= 30000 && p <= 30020);
  if (feedPorts.length) {
    out.push(line("ok", "4. Port de flux", `${feedPorts.join(", ")} ${C.dim("— une session est armée")}`));
  } else {
    out.push(line("warn", "4. Port de flux", C.amber("aucun port 30000-30020 à l'écoute")));
    out.push(C.dim("      GoKarts n'ouvre le flux que lorsqu'une session est armée."));
    out.push(C.dim("      Sans ce port, AUCUN passage ne peut parvenir au tableau de bord."));
  }
  const apexPorts = d.ports.filter((p) => p < 30000);
  out.push(line(apexPorts.length ? "ok" : "warn", "   Ports Apex", apexPorts.length ? apexPorts.join(", ") + C.dim("  (3050 Firebird · 3074 bus · 9120/9122 API)") : "aucun"));

  // 5. bridge
  if (!d.health) {
    out.push(line("bad", "5. Pont MegaKart", `injoignable sur ${BRIDGE} — lancez 'node bridge.mjs'`));
  } else {
    out.push(line("ok", "5. Pont MegaKart", C.dim(`${BRIDGE} · v${d.health.version}`)));
    out.push(d.health.connected
      ? line("ok", "   Flux attaché", `${d.health.feed}`)
      : line("warn", "   Flux attaché", C.amber(`non — le pont cherche (${d.health.feed})`)));
  }

  // 6. traffic
  if (d.live) {
    const c = d.live.counts || {};
    out.push(line(c.NREC > 0 ? "ok" : "warn", "6. Trafic reçu",
      `SYNC ${c.SYNC ?? 0} · NREC ${c.NREC ?? 0} · STY ${c.STY ?? 0}` +
      C.dim(`  · statut « ${d.live.status} »`)));
    const drivers = (d.live.drivers || []).length;
    out.push(line(drivers ? "ok" : "warn", "   Pilotes vus", drivers ? String(drivers) : "aucun"));

    // 7. our chrono
    const ch = d.live.chrono;
    if (ch) {
      out.push(ch.running
        ? line("ok", "7. Chrono MegaKart", `EN COURS · ${Math.round(ch.elapsedMs / 1000)}s · ${ch.ledgerSize} passages` + C.dim(`  · garde ${ch.minLapMs} ms`))
        : line("ok", "7. Chrono MegaKart", C.dim(`à l'arrêt · garde ${ch.minLapMs} ms`)));
      if (ch.classification?.integrity && !ch.classification.integrity.complete) {
        out.push(line("bad", "   Intégrité", `flux interrompu ${ch.classification.integrity.feedDrops}x pendant la course`));
      }
    }
  }

  // verdict
  out.push(C.dim("  " + "─".repeat(74)));
  const blocked =
    !d.health ? "Le pont n'est pas lancé. Démarrez 'node bridge.mjs'."
    : !running.get("GoKarts") ? "GoKarts est arrêté."
    : !feedPorts.length ? "Aucune session armée dans GoKarts — c'est là que la chaîne s'arrête."
    : !d.health.connected ? "Le port de flux existe mais le pont n'y est pas encore attaché."
    : (d.live?.counts?.NREC ?? 0) === 0 ? "Tout est connecté ; en attente d'un premier passage sur la boucle."
    : null;
  out.push(blocked ? "  " + C.amber("→ " + blocked) : "  " + C.green("→ Chaîne complète : les passages parviennent au tableau de bord."));
  out.push("");
  return out.join("\n");
}

async function tick() {
  const d = await collect();
  if (!ONCE) process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(render(d));
  if (!ONCE) process.stdout.write(C.dim("\n  Ctrl+C pour quitter · actualisation toutes les 3s\n"));
}

await tick();
if (!ONCE) {
  const t = setInterval(tick, 3000);
  process.on("SIGINT", () => { clearInterval(t); console.log(""); process.exit(0); });
}
