"use client";

// The sidebar's system card: are the desk, the sign-up bridge and the chrono up, is an update
// waiting, and the "Synchroniser" button that restarts the desk and the bridge through their
// own launchers - the same restart-desk.bat / restart-bridge.bat a double-click would run.
//
// MegaKart Timing Control is shown but never restarted from here: it owns COM3 and may be
// timing a race. The button asks first, and the page reloads itself once both are back.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { BRIDGE_URL } from "@/lib/bridge-client";
import { timing } from "@/lib/timing-client";
import {
  isLoopbackHost, isVenueHost, summarize,
  type BridgeHealth, type DeskProbe, type DeskSystem,
} from "@/lib/system-status";

const POLL_MS = 15_000;
const SYNC_TIMEOUT_MS = 45_000;
const DESK_URL = "http://127.0.0.1:5190";

async function probeDesk(): Promise<DeskProbe> {
  if (typeof window !== "undefined" && !isVenueHost(window.location.hostname)) return { kind: "hosted" };
  try {
    const res = await fetch("/api/system", { cache: "no-store" });
    if (res.status === 403) return { kind: "wifi" };
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.includes("application/json")) return { kind: "old" };
    return { kind: "ok", system: (await res.json()) as DeskSystem };
  } catch {
    return { kind: "down" };
  }
}

async function probeBridge(): Promise<BridgeHealth> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as BridgeHealth;
  } catch {
    return null;
  }
}

async function probeChrono(): Promise<{ online: boolean; racing: boolean }> {
  try {
    const h = await timing.health();
    return { online: true, racing: h.raceState === "RUNNING" };
  } catch {
    return { online: false, racing: false };
  }
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

type Phase = { kind: "idle" } | { kind: "confirm" } | { kind: "syncing"; step: string } | { kind: "failed"; message: string };

export function SystemStatus() {
  const [desk, setDesk] = useState<DeskProbe>({ kind: "down" });
  const [bridge, setBridge] = useState<BridgeHealth>(null);
  const [chrono, setChrono] = useState({ online: false, racing: false });
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // The bundle this page was loaded from: a newer one on disk means the page itself is stale.
  const [pageBundleAt, setPageBundleAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [d, b, c] = await Promise.all([probeDesk(), probeBridge(), probeChrono()]);
    if (d.kind === "ok") setPageBundleAt((prev) => prev ?? d.system.bundleBuiltAt);
    setDesk(d);
    setBridge(b);
    setChrono(c);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [refresh]);

  const summary = summarize(desk, bridge, chrono.online, pageBundleAt, DESK_URL);
  const busy = phase.kind === "syncing";

  const synchronise = async () => {
    if (desk.kind !== "ok") return;
    const before = { desk: desk.system.startedAt, bridge: bridge?.startedAt ?? 0 };
    setPhase({ kind: "syncing", step: "Vérification du code…" });
    let res: Response;
    try {
      res = await fetch("/api/system/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-MegaKart": "synchroniser" },
        body: JSON.stringify({ services: ["bridge", "desk"] }),
      });
    } catch {
      setPhase({ kind: "failed", message: "Accueil injoignable : rien n’a été redémarré." });
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setPhase({ kind: "failed", message: body?.error || `Refusé (${res.status}) : rien n’a été redémarré.` });
      return;
    }

    // Wait for both to come back as NEW processes, not merely for an answer: the old desk keeps
    // answering for a second or two until its launcher stops it.
    const started = Date.now();
    let deskBack = false;
    let bridgeBack = false;
    while (Date.now() - started < SYNC_TIMEOUT_MS) {
      await sleep(1000);
      if (!deskBack) {
        const d = await probeDesk();
        deskBack = d.kind === "ok" && d.system.startedAt > before.desk;
      }
      if (!bridgeBack) {
        const b = await probeBridge();
        bridgeBack = !!b?.ok && b.startedAt != null && b.startedAt > before.bridge;
      }
      setPhase({ kind: "syncing", step: `Accueil ${deskBack ? "✓" : "…"} · Inscriptions ${bridgeBack ? "✓" : "…"}` });
      if (deskBack && bridgeBack) {
        await sleep(400);
        window.location.reload();
        return;
      }
    }
    const missing = [!deskBack && "« MegaKart Accueil »", !bridgeBack && "« MegaKart Inscriptions »"].filter(Boolean).join(" et ");
    setPhase({ kind: "failed", message: `Pas revenu à temps : ouvrez ${missing} dans la barre des tâches pour lire l’erreur.` });
  };

  const wrongAddress = desk.kind === "wifi" && typeof window !== "undefined" && !isLoopbackHost(window.location.hostname);

  return (
    <div className={`system-status sys-${summary.tone}`}>
      <span><i /> {loaded ? summary.title : "Vérification…"}</span>
      <small>
        {wrongAddress
          ? <>Rien ne peut être enregistré ici : <a href={`${DESK_URL}${window.location.hash}`}>ouvrir 127.0.0.1</a></>
          : loaded ? summary.detail : " "}
      </small>

      <ul className="sys-rows">
        {summary.rows.map((r) => (
          <li key={r.label} className={r.up ? "is-up" : "is-down"}><i />{r.label}</li>
        ))}
      </ul>

      {summary.canSync && phase.kind === "idle" && (
        <button type="button" className={"sys-sync" + (summary.pending.length || summary.tone === "warn" ? " is-due" : "")}
          onClick={() => setPhase({ kind: "confirm" })}>
          <RefreshCw size={13} /> Synchroniser
        </button>
      )}

      {phase.kind === "confirm" && (
        <div className="sys-confirm">
          <p>Redémarre l’accueil et le pont d’inscription (≈ 10 s), puis recharge cette page. Le chrono n’est pas touché.</p>
          {chrono.racing && <p className="sys-warn">Une course est en cours : le chrono continue, mais le formulaire d’inscription sera coupé quelques secondes.</p>}
          <div>
            <button type="button" className="sys-sync is-due" onClick={() => void synchronise()}><RefreshCw size={13} /> Synchroniser</button>
            <button type="button" className="sys-cancel" onClick={() => setPhase({ kind: "idle" })}>Annuler</button>
          </div>
        </div>
      )}

      {busy && <p className="sys-progress"><RefreshCw size={13} className="sys-spin" /> {phase.step}</p>}

      {phase.kind === "failed" && (
        <div className="sys-confirm">
          <p className="sys-warn">{phase.message}</p>
          <div><button type="button" className="sys-cancel" onClick={() => { setPhase({ kind: "idle" }); void refresh(); }}>OK</button></div>
        </div>
      )}
    </div>
  );
}
