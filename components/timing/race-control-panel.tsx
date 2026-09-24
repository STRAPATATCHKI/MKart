"use client";

// Race control from the dashboard: the same PREPARE / START / FINISH / NEXT the desktop
// Timing Control offers, against the same controller. The panel is deliberately honest about
// state: every button is enabled only when Timing Control would accept it, and a refusal is
// shown in the operator's words rather than swallowed.
import { ChevronDown, ChevronRight, Flag, Play, RotateCcw, Send, SkipForward, Square } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { DriverAvatar } from "@/components/big-screen/driver-avatar";
import { avgSpeedKmh, fmtLap, fmtSpeed, hasLapList, isExpanded, lapRows } from "@/components/timing/lap-rows";
import { LiveTrack, type TrackDriver } from "@/components/track/live-track";
import { requestStartLights } from "@/lib/screen-channel";
import { explainTimingError, timing, TimingOffline, type TimingCommandResult } from "@/lib/timing-client";
import { useTrackRoute } from "@/hooks/use-track";
import { TRACK_HEIGHT, TRACK_WIDTH } from "@/lib/track";
import type { TimingView } from "@/hooks/use-timing";

export type RaceDraft = {
  name: string;
  durationMin: number;
  /** Decides the ranking: a race counts laps, everything else the best lap. */
  rankMode?: "course" | "chronos";
  drivers: { name: string; kart: number; color?: number; grid?: number }[];
};

type Props = {
  view: TimingView;
  /** What the session form currently holds - sent to the chrono by PREPARE. */
  draft: RaceDraft | null;
  onNotice: (tone: "ok" | "warn", text: string) => void;
};

const fmtClock = (ms: number | null) => {
  if (ms == null) return "--:--";
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

const STATE_FR: Record<string, string> = {
  IDLE: "Aucune course", PREPARED: "Prête", RUNNING: "EN COURSE", FINISHED: "Terminée", RESETTING_FOR_NEXT: "Réinitialisation",
};

export function RaceControlPanel({ view, draft, onNotice }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [openLaps, setOpenLaps] = useState<Record<string, boolean>>({});   // only what the operator clicked
  const route = useTrackRoute();          // the same circuit the operator drew, live-reloaded
  const race = view.race;
  const state = race?.state ?? "IDLE";
  const running = state === "RUNNING";
  // A new race is a new set of drivers, so what the operator folded away in the last session
  // must not decide what opens in this one: after « Session suivante » a lone pilot's laps
  // would otherwise stay hidden because someone collapsed them an hour ago.
  const raceId = race?.raceId ?? null;
  useEffect(() => {
    const id = window.setTimeout(() => setOpenLaps({}), 0);
    return () => window.clearTimeout(id);
  }, [raceId]);

  const run = async (label: string, action: () => Promise<TimingCommandResult>) => {
    setBusy(label);
    try {
      const res = await action();
      if (res.success) onNotice("ok", `${label} : ${STATE_FR[res.state] ?? res.state}${res.raceId ? ` · ${res.raceId}` : ""}`);
      else onNotice("warn", explainTimingError(res.error, res.message));
    } catch (e) {
      onNotice("warn", e instanceof TimingOffline ? "MegaKart Timing Control est hors ligne : lancez-le sur le PC du chrono." : String(e));
    } finally {
      setBusy(null);
      view.refresh();
    }
  };

  // DÉPART goes through the TV when there is one: it runs red → green on the wall and releases
  // the chrono itself at green, so the pilots and the clock agree on the moment. With no TV
  // answering, the chrono is armed directly - a race must never fail to start because a screen
  // is off.
  const start = async () => {
    setBusy("Départ");
    try {
      const taken = await requestStartLights();
      if (taken) {
        onNotice("ok", "Feux de départ sur l’écran TV — le chrono part au vert.");
        return;
      }
    } finally {
      setBusy(null);
    }
    await run("Départ", timing.start);
  };

  const prepare = () => {
    if (!draft) return;
    const drivers = draft.drivers.filter((d) => d.name.trim() && d.kart > 0).map((d) => ({ name: d.name.trim(), kart: d.kart, grid: d.grid }));
    if (drivers.length === 0) {
      onNotice("warn", "Renseignez au moins un pilote avec un numéro de kart avant d’envoyer au chrono.");
      return;
    }
    void run("Préparation", () => timing.prepare(draft.name.trim() || "Course", Math.round(draft.durationMin * 60_000), drivers, undefined, draft.rankMode ?? "course"));
  };

  const dot = (ok: boolean) => <span style={{ color: ok ? "#38e07b" : "#ff6b69" }}>●</span>;

  return (
    <section id="race-control" className="panel" style={{ marginTop: 16, scrollMarginTop: 16 }}>
      <div className="panel-header">
        <div><span className="panel-kicker">CHRONO MEGAKART</span><h2>Contrôle de course</h2></div>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#8aa0b6" }}>
          <span>{dot(view.online)} Timing Control</span>
          <span>{dot(!!view.health?.comConnected)} ActiveBox COM3</span>
        </div>
      </div>

      {!view.online ? (
        <div className="empty-state" style={{ padding: "22px 18px" }}>
          <strong>MegaKart Timing Control ne répond pas</strong>
          <span>Ouvrez-le sur le PC du chrono (raccourci bureau). Les inscriptions et la caisse continuent normalement.</span>
        </div>
      ) : (
        <div className="race-deck">
          {/* The circuit takes the top at full width - it is what the operator and everyone at
              the desk actually watch - with the controls below it, in reach. */}
          <div className="race-deck-track">
            <div className="race-deck-head">
              <div className="race-deck-id">
                <small>Course actuelle</small>
                <b>{race?.raceName ?? "Aucune course"}{race?.raceId ? " · " + race.raceId : ""}{race?.rankMode === "chronos" ? " · CHRONO" : ""}</b>
                <span className={"race-deck-state" + (running && race?.clockStarted === false ? " is-armed" : running ? " is-live" : "")}>
                  <i />{running && race?.clockStarted === false ? "Armée — départ au premier passage" : (STATE_FR[state] ?? state)}
                </span>
              </div>
              <span className={"race-deck-clock" + (running && race?.clockStarted === false ? " is-armed" : running ? " is-live" : "")}>
                {fmtClock(race?.remainingMs ?? null)}
              </span>
            </div>

            {/* Live circuit. Position between crossings is estimated from the last lap time;
                every real crossing snaps the kart back to the line. */}
            <div style={{ background: "#0b1016", borderRadius: 10, padding: 6, marginBottom: 10 }}>
              <LiveTrack
                // The chrono resolves colours so no two karts in one race look alike; use
                // its answer rather than the raw kart map, which may repeat a colour.
                drivers={(race?.drivers ?? []) as TrackDriver[]}
                points={route.points}
                start={route.start}
                width={TRACK_WIDTH}
                height={TRACK_HEIGHT}
                running={running && race?.clockStarted !== false}
              />
            </div>
          </div>

          <div className="qr-list-header" style={{ gridTemplateColumns: "40px 50px 2fr 60px 60px 1fr 1fr" }}>
              <span>POS</span><span>GRILLE</span><span>PILOTE</span><span>KART</span><span>TOURS</span><span>DERNIER</span><span>MEILLEUR</span>
            </div>
            {(race?.drivers ?? []).length === 0 ? (
              <div className="empty-state" style={{ padding: "18px" }}>
                <Flag size={20} /><strong>Aucun pilote au chrono</strong>
                <span>Remplissez le formulaire de session puis « Envoyer au chrono ».</span>
              </div>
            ) : (
              race!.drivers.map((d) => {
                const pilot = (d as TrackDriver).color ?? view.karts.find((k) => k.kart === d.kart)?.color ?? null;
                const detailed = hasLapList(d);
                const open = detailed && isExpanded(d.transponder, openLaps, race!.drivers.length);
                const laps = open ? lapRows(d) : [];
                return (
                  <Fragment key={d.transponder}>
                  <article className="qr-reservation-row" style={{ gridTemplateColumns: "40px 50px 2fr 60px 60px 1fr 1fr", alignItems: "center" }}>
                    <strong>{d.position ?? "—"}</strong>
                    <span style={{ color: "#8aa0b6" }}>{d.grid ? `P${d.grid}` : "—"}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {pilot ? <DriverAvatar pilot={pilot} seed={d.driver} size="26px" /> : null}
                      <span>{d.driver}</span>
                    </span>
                    {/* Live kart change, for an incident: pick the spare, done. The chrono keeps
                        the driver's laps and times the incident lap from their last crossing. Only
                        karts nobody else is in are offered, so a mistake here is not possible. */}
                    {(state === "PREPARED" || state === "RUNNING") ? (
                      <select
                        value={String(d.kart)}
                        disabled={!!busy}
                        title="Changer de kart (incident)"
                        onChange={(e) => {
                          const kart = Number(e.target.value);
                          if (kart && kart !== d.kart) void run(`${d.driver} → kart ${kart}`, () => timing.changeKart(d.transponder, kart));
                        }}
                        style={{ background: "#0f151b", color: "#eaf0e4", border: "1px solid #253040", borderRadius: 6,
                                 padding: "3px 6px", font: "inherit", fontWeight: 700, cursor: "pointer" }}
                      >
                        {view.karts
                          .filter((k) => k.enabled !== false && k.transponder)
                          .filter((k) => k.kart === d.kart || !race!.drivers.some((o) => o.kart === k.kart))
                          .sort((a, b) => a.kart - b.kart)
                          .map((k) => <option key={k.kart} value={k.kart}>{k.kart}</option>)}
                      </select>
                    ) : (
                      <span>{d.kart}</span>
                    )}
                    {detailed ? (
                      <button type="button" onClick={() => setOpenLaps((o) => ({ ...o, [d.transponder]: !open }))}
                        title={open ? "Masquer le détail des tours" : "Voir tous les tours"}
                        style={{ display: "flex", alignItems: "center", gap: 3, padding: 0, border: 0, background: "none", color: "inherit", font: "inherit", fontWeight: 700, cursor: "pointer" }}>
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{d.laps}
                      </button>
                    ) : (
                      <strong>{d.laps}</strong>
                    )}
                    <span style={{ fontFamily: "monospace" }}>{fmtLap(d.lastLapMs)}</span>
                    <span style={{ fontFamily: "monospace", color: "#d8ff35" }}>
                      {fmtLap(d.bestLapMs)}
                      {avgSpeedKmh(d.bestLapMs, race?.trackLengthM) != null
                        ? <small style={{ display: "block", color: "#8aa0b6", fontFamily: "inherit" }}>{fmtSpeed(d.bestLapMs, race?.trackLengthM)}</small>
                        : null}
                    </span>
                  </article>
                  {open ? (
                    <div style={{ padding: "2px 16px 12px 62px", borderBottom: "1px solid #202722" }}>
                      {laps.length === 0 ? (
                        <span style={{ fontSize: 12, color: "#8aa0b6" }}>Aucun tour chronométré pour l’instant.</span>
                      ) : (
                        // Wrapping columns rather than one long list: a 20-lap endurance still fits
                        // the panel without pushing the next driver off the screen.
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "2px 18px" }}>
                          {laps.map((l) => (
                            <span key={l.lap} style={{ display: "flex", gap: 10, fontFamily: "monospace", fontSize: 13, color: l.best ? "#d8ff35" : undefined }}>
                              <span style={{ minWidth: 26, color: "#8aa0b6" }}>T{l.lap}</span>
                              <span>{fmtLap(l.ms)}</span>
                              <span style={{ color: l.best ? "#d8ff35" : "#8aa0b6" }}>{l.delta ?? "meilleur"}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                  </Fragment>
                );
              })
            )}
          {race?.absenceCalibrated === false ? (
            <small style={{ display: "block", color: "#8aa0b6" }}>
              Filtre de passage provisoire ({race.absenceSeconds}s d’absence) — calibrage final à faire avec un kart en mouvement.
            </small>
          ) : null}

          {/* The four race verbs as one bar of large targets. Each keeps the colour it already
              had, so the muscle memory of whoever runs the desk still works. */}
          <div className="race-deck-controls">
            <button type="button" className="deck-btn deck-btn--prepare" disabled={!!busy || running || !draft}
              onClick={prepare} title="Envoie les pilotes et karts du formulaire au chrono">
              <Send size={17} /><span>Envoyer au chrono<small>PREPARE</small></span>
            </button>
            <button type="button" className="deck-btn deck-btn--start" disabled={!!busy || state !== "PREPARED"}
              onClick={() => void start()} title="Lance la course : les feux sur l’écran TV, puis le chrono part au premier passage">
              <Play size={17} /><span>Départ<small>START</small></span>
            </button>
            <button type="button" className="deck-btn deck-btn--finish" disabled={!!busy || !running}
              onClick={() => { if (window.confirm("Terminer la course maintenant et figer le résultat ?")) void run("Arrivée", timing.finish); }}
              title="Fige le résultat">
              <Square size={17} /><span>Arrivée<small>FINISH</small></span>
            </button>
            <div className="race-deck-minor">
              <button type="button" className="deck-btn deck-btn--ghost" disabled={!!busy || state === "IDLE"}
                onClick={() => { if (!running || window.confirm("La course est en cours. Tout remettre à zéro ?")) void run("Reset", timing.reset); }}>
                <RotateCcw size={15} /> Reset
              </button>
              <button type="button" className="deck-btn deck-btn--ghost" disabled={!!busy || running}
                onClick={() => void run("Session suivante", timing.next)}>
                <SkipForward size={15} /> Session suivante
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
