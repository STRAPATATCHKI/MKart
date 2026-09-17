"use client";

// "Saisir dans GoKarts" — assisted typing.
//
// Sends the pilot names as keystrokes to the window the operator has focused, after the
// helper has verified that window is GoKarts. It presses no button and clicks nothing:
// arming the session stays a human action, and kart power / speed / start lights are never
// touched by any of this.
//
// Defaults to a rehearsal in Notepad. Typing into live race software is opt-in, on purpose.

import { useState } from "react";
import { sortForGokarts, type GokartsPilot } from "@/lib/clipboard";

type Result = {
  exitCode: number;
  typed: boolean;
  aborted: boolean;
  dryRun: boolean;
  names: string[];
  output: string;
  error: string | null;
};

export function TypistButton({ pilots }: { pilots: GokartsPilot[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [nav, setNav] = useState<"Enter" | "Tab" | "Down">("Enter");

  const names = sortForGokarts(pilots).map((p) => p.fullName);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/typist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names, nav, dryRun, countdown: 5 }),
      });
      setResult(await r.json());
    } catch {
      setResult({
        exitCode: -1, typed: false, aborted: true, dryRun, names,
        output: "", error: "La borne ne répond pas.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="fa-copy" onClick={() => setOpen(true)} disabled={names.length === 0}>
        Saisir dans GoKarts…
      </button>
    );
  }

  return (
    <div className="ty-panel">
      <div className="ty-head">
        <strong>Saisie assistée dans GoKarts</strong>
        <button type="button" className="ty-close" onClick={() => { setOpen(false); setResult(null); }}>Fermer</button>
      </div>

      {/* The order matters and is the whole fix: launch FIRST, then click into GoKarts. The
          helper waits for that window instead of stealing focus, so there is no race. */}
      <ol className="ty-steps">
        <li>Ouvrez la session dans GoKarts (les karts déjà attribués).</li>
        <li><strong>Lancez la saisie ci-dessous</strong> — elle attend, sans rien faire.</li>
        <li><strong>Cliquez dans la première cellule Pilote de GoKarts.</strong> Ce seul clic met
          GoKarts devant et place le curseur : la saisie démarre toute seule.</li>
        <li>Ne touchez plus à rien. Elle s’arrête si la fenêtre change.</li>
      </ol>

      <div className="ty-row">
        <label>
          Touche entre deux noms
          <select value={nav} onChange={(e) => setNav(e.target.value as typeof nav)}>
            <option value="Enter">Entrée</option>
            <option value="Tab">Tabulation</option>
            <option value="Down">Flèche bas</option>
          </select>
        </label>
        <span className="ty-count">{names.length} nom{names.length > 1 ? "s" : ""}</span>
      </div>

      <pre className="ty-preview">{names.join("\n")}</pre>

      <div className="ty-actions">
        {/* Rehearse first. The real run is the second button, deliberately. */}
        <button type="button" className="fa-copy" onClick={() => void run(true)} disabled={busy}>
          {busy ? "…" : "Essai dans le Bloc-notes"}
        </button>
        <button type="button" className="ty-go" onClick={() => void run(false)} disabled={busy}>
          {busy ? "Saisie…" : "Saisir dans GoKarts"}
        </button>
      </div>

      {result && (
        <div className={`ty-result is-${result.typed ? "ok" : "bad"}`}>
          <strong>
            {result.typed
              ? `${result.names.length} nom(s) saisi(s)${result.dryRun ? " dans le Bloc-notes" : " dans GoKarts"}.`
              : result.exitCode === 1 ? `Rien saisi — vous n’avez pas cliqué dans ${result.dryRun ? "le Bloc-notes" : "GoKarts"} à temps.`
              : result.exitCode === 2 ? "Interrompu — la fenêtre a changé pendant la saisie."
              : result.exitCode === 3 ? "Windows a refusé l’injection clavier. Saisissez les noms à la main."
              : result.error || "La saisie a échoué."}
          </strong>
          {result.typed && !result.dryRun && (
            <span>Vérifiez la grille, puis armez la session vous-même dans GoKarts.</span>
          )}
          {result.output && <pre className="ty-log">{result.output.trim().split("\n").slice(-6).join("\n")}</pre>}
        </div>
      )}
    </div>
  );
}
