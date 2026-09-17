"use client";

// The MegaKart chrono panel: our own race window, on top of the read-only Apex feed.
//
// Two rules shaped this component:
//
// 1. It must never imply it controls karts. The button says "Démarrer le chrono", never
//    "Départ", and a permanent note states that it counts laps and does not release karts.
//    Start lights and kart power stay manual, on purpose.
//
// 2. It must never be confidently wrong. "Nobody has crossed yet" and "we are receiving
//    nothing" look identical on a leaderboard, so they are shown as distinct states, and a
//    race counted across a feed outage stays marked incomplete.

import { useChrono, fmtLap, fmtClock, type ChronoRow } from "@/hooks/use-chrono";

export function ChronoPanel({ sessionId, sessionName }: { sessionId?: string | null; sessionName?: string | null }) {
  const { chrono, bridgeConnected, feedConnected, busy, error, start, stop, reset, reclassify } = useChrono();

  const running = !!chrono?.running;
  const cls = chrono?.classification ?? null;
  const rows = cls?.rows ?? [];
  const hasResult = !running && !!cls && rows.length > 0;

  return (
    <section className="chrono" aria-label="Chrono MegaKart">
      <header className="chrono-head">
        <div>
          <span className="eyebrow"><i /> CHRONO MEGAKART</span>
          <h2>{running ? "Chronométrage en cours" : hasResult ? "Course terminée" : "Chrono à l’arrêt"}</h2>
          <p>
            MegaKart compte les tours lui-même à partir des passages sur la boucle.
            {" "}<strong>Ce chrono ne lance pas les karts</strong> — feux et mise en piste restent manuels.
          </p>
        </div>

        <div className="chrono-actions">
          {running ? (
            <>
              <div className="chrono-clock" aria-live="off">{fmtClock(chrono?.elapsedMs ?? 0)}</div>
              <button type="button" className="chrono-stop" onClick={() => void stop()} disabled={busy}>
                {busy ? "…" : "Arrêter le chrono"}
              </button>
            </>
          ) : (
            <>
              {hasResult && (
                <button type="button" className="chrono-ghost" onClick={() => void reset()} disabled={busy}>
                  Effacer
                </button>
              )}
              <button
                type="button"
                className="chrono-start"
                onClick={() => void start({ sessionId, name: sessionName })}
                disabled={busy || !bridgeConnected}
                title={!bridgeConnected ? "Le pont de chronométrage est hors ligne" : undefined}
              >
                {busy ? "…" : "Démarrer le chrono"}
              </button>
            </>
          )}
        </div>
      </header>

      <ChronoStatus
        bridgeConnected={bridgeConnected}
        feedConnected={feedConnected}
        running={running}
        crossings={cls?.totalCrossings ?? 0}
        error={error}
      />

      {rows.length > 0 ? (
        <table className="chrono-table">
          <thead>
            <tr>
              <th>POS</th><th>PILOTE</th><th>KART</th>
              <th>TOURS</th><th>DERNIER</th><th>MEILLEUR</th><th>ÉCART</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={r.transponder} row={r} fastest={cls?.fastest?.transponder === r.transponder} />)}
          </tbody>
        </table>
      ) : (
        <div className="chrono-empty">
          {running
            ? feedConnected
              ? "En attente du premier passage sur la boucle…"
              : "Aucun flux de chronométrage : aucun passage ne peut être reçu."
            : "Démarrez le chrono, puis lancez les karts comme d’habitude."}
        </div>
      )}

      {hasResult && cls && (
        <Integrity cls={cls} chrono={chrono!} busy={busy} onReclassify={(ms) => void reclassify(ms)} />
      )}
    </section>
  );
}

/**
 * The honesty strip. A leaderboard with no rows is ambiguous — it can mean "the race has not
 * started" or "we are blind". An operator must be able to tell those apart at a glance.
 */
function ChronoStatus({ bridgeConnected, feedConnected, running, crossings, error }: {
  bridgeConnected: boolean; feedConnected: boolean; running: boolean; crossings: number; error: string | null;
}) {
  let tone: "ok" | "warn" | "bad" = "ok";
  let text: string;

  if (error) { tone = "bad"; text = error; }
  else if (!bridgeConnected) { tone = "bad"; text = "Pont de chronométrage hors ligne — démarrez bridge.mjs sur le PC du chronométrage."; }
  else if (!feedConnected) {
    tone = "warn";
    text = "Pont en ligne, mais aucun flux GoKarts. Le flux n’existe que lorsqu’une session est armée dans GoKarts.";
  } else if (running && crossings === 0) { tone = "warn"; text = "Flux connecté — aucun passage détecté pour l’instant."; }
  else if (running) { tone = "ok"; text = `Flux connecté — ${crossings} passage${crossings > 1 ? "s" : ""} compté${crossings > 1 ? "s" : ""}.`; }
  else { tone = "ok"; text = "Flux connecté — prêt."; }

  return <div className={`chrono-status is-${tone}`} role="status">{text}</div>;
}

function Row({ row, fastest }: { row: ChronoRow; fastest: boolean }) {
  return (
    <tr className={row.position === 1 ? "is-leader" : undefined}>
      <td className="chrono-pos">{String(row.position).padStart(2, "0")}</td>
      <td className="chrono-name">
        {row.name ?? <span className="chrono-unknown">Transpondeur {row.transponder}</span>}
      </td>
      <td>{row.kart != null ? `Kart ${row.kart}` : "—"}</td>
      <td className="chrono-num">{row.laps}</td>
      <td className="chrono-num">{fmtLap(row.lastLapMs)}</td>
      <td className={`chrono-num${fastest ? " is-fastest" : ""}`}>{fmtLap(row.bestLapMs)}</td>
      <td className="chrono-num">{row.gapText ?? "—"}</td>
    </tr>
  );
}

/**
 * A result is only trustworthy if we say plainly where it might not be — and, where we can,
 * let the operator fix it. The double-read guard is a guess about THIS track: set it too high
 * and real laps vanish from the board without any error. So the number is always on screen,
 * the hidden count is always on screen, and both can be corrected without re-running the race,
 * because every crossing is still in the ledger.
 */
function Integrity({ cls, chrono, onReclassify, busy }: {
  cls: NonNullable<NonNullable<ReturnType<typeof useChrono>["chrono"]>["classification"]>;
  chrono: NonNullable<ReturnType<typeof useChrono>["chrono"]>;
  onReclassify: (ms: number) => void;
  busy: boolean;
}) {
  const i = cls.integrity;
  const hidden = i.excludedByGuard;
  return (
    <div className={`chrono-integrity${i.complete ? "" : " is-suspect"}`}>
      {i.complete
        ? <strong>Résultat complet</strong>
        : <strong>Résultat incomplet — le flux a été interrompu {i.feedDrops} fois pendant la course</strong>}
      <span>
        {cls.pilots} pilote{cls.pilots > 1 ? "s" : ""} · {cls.totalCrossings} passages retenus
        {` · ${i.ledgerSize} enregistrés`}
        {chrono.stoppedAt && ` · arrêté à ${new Date(chrono.stoppedAt).toLocaleTimeString("fr-FR")}`}
      </span>

      <div className="chrono-guard">
        <label htmlFor="chrono-guard-input">
          Écart minimum entre deux passages d’un même kart
        </label>
        <div className="chrono-guard-row">
          <input
            id="chrono-guard-input"
            type="number"
            min={0}
            step={50}
            defaultValue={chrono.minLapMs}
            onKeyDown={(e) => {
              if (e.key === "Enter") onReclassify(Number((e.target as HTMLInputElement).value));
            }}
          />
          <span>ms</span>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("chrono-guard-input") as HTMLInputElement | null;
              if (el) onReclassify(Number(el.value));
            }}
            disabled={busy}
          >
            Recalculer
          </button>
        </div>
        {hidden > 0 && (
          <p className="chrono-guard-warn">
            {hidden} passage{hidden > 1 ? "s" : ""} masqué{hidden > 1 ? "s" : ""} par ce réglage.
            Si des tours manquent au classement, baissez cette valeur et recalculez —
            aucun passage n’est perdu.
          </p>
        )}
      </div>
    </div>
  );
}
