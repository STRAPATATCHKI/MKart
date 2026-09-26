"use client";

// COURSE EN DIRECT — the race on track, as MegaKart Timing Control times it.
//
// A page to watch, not to drive: the clock, the circuit with the karts moving on it, the
// classement by best lap (laps do not count), the selected pilot's every lap, and how far the
// best lap is from the day's best and the track record. Starting and stopping races stays in
// Sessions → Contrôle de course, one button away; so a click here can never end a race.
//
// With no race on track it shows the last result, ready for the TV podium or the printer.

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, Flag, Gauge, MonitorPlay, Pencil, Printer, SlidersHorizontal, Timer, Trophy, X } from "lucide-react";
import { DriverAvatar } from "@/components/big-screen/driver-avatar";
import { LiveTrack, PILOT_HEX, type TrackDriver } from "@/components/track/live-track";
import { fmtLap, hasLapList, lapRows } from "@/components/timing/lap-rows";
import { printTimings } from "@/components/timing/print-timings";
import { useSavedRaces } from "@/hooks/use-saved-races";
import { useTiming } from "@/hooks/use-timing";
import { useTrackRoute } from "@/hooks/use-track";
import { useTrackRecord } from "@/hooks/use-track-record";
import { byBestLap } from "@/lib/best-lap-order";
import { averageLap, fmtGap, fmtSince, liveBoard, raceProgress } from "@/lib/live-board";
import { souvenirFromSavedRace } from "@/lib/saved-race-souvenir";
import { showResultOnBigScreen } from "@/lib/screen-channel";
import { TRACK_HEIGHT, TRACK_WIDTH } from "@/lib/track";
import { compareToRecord, dayBestLap } from "@/lib/track-record";
import type { TimingSavedRace } from "@/lib/timing-client";

const STATE_FR: Record<string, string> = {
  IDLE: "AUCUNE COURSE", PREPARED: "SUR LA GRILLE", RUNNING: "EN COURSE", FINISHED: "TERMINÉE", RESETTING_FOR_NEXT: "RÉINITIALISATION",
};

const fmtClock = (ms: number | null | undefined) => {
  if (ms == null) return "--:--";
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

const endedAt = (r: TimingSavedRace) => r.finishedAt ?? r.savedAt ?? r.startedAt ?? 0;
const isSim = (r: TimingSavedRace) => /^\s*\[sim\]/i.test(r.name ?? "");

export function LiveRaceConsole({ trackEditor, onOpenControls }: {
  /** The circuit editor ("Ajuster la piste"), shown in place of the live map while open. */
  trackEditor: ReactNode;
  onOpenControls: () => void;
}) {
  const view = useTiming(1000);
  const route = useTrackRoute();
  const { record } = useTrackRecord();
  const saved = useSavedRaces();
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // A clock for "last crossing 12 s ago" and the stalled flag; the live frame itself is polled by useTiming.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const race = view.race;
  const state = race?.state ?? "IDLE";
  const running = state === "RUNNING";
  const armed = running && race?.clockStarted === false;
  const drivers = useMemo(() => race?.drivers ?? [], [race]);
  const onTrack = drivers.length > 0 && state !== "IDLE";
  const board = useMemo(() => liveBoard(drivers, now, running && !armed), [drivers, now, running, armed]);
  const selected = board.find((r) => r.driver.transponder === picked) ?? board[0] ?? null;
  const leader = board[0]?.position === 1 ? board[0] : null;
  const progress = raceProgress(race);
  const totalMs = race?.durationMs ?? (race?.durationS != null ? race.durationS * 1000 : null);
  const vsRecord = compareToRecord(leader?.driver.bestLapMs, record);
  const dayBest = useMemo(
    () => dayBestLap(saved.races, drivers.map((d) => ({ driver: d.driver, bestLapMs: d.bestLapMs })), record),
    [saved.races, drivers, record],
  );
  const last = useMemo(
    () => [...saved.races].filter((r) => !isSim(r) && r.racers.length > 0).sort((a, b) => endedAt(b) - endedAt(a))[0] ?? null,
    [saved.races],
  );
  const colorOf = (d: { kart: number; color?: number | null }) => d.color ?? view.karts.find((k) => k.kart === d.kart)?.color ?? null;
  const stalled = board.filter((r) => r.stalled);

  const badge = !view.online ? { cls: "is-off", label: "CHRONO HORS LIGNE" }
    : armed ? { cls: "is-armed", label: "ARMÉE · DÉPART AU 1ER PASSAGE" }
    : { cls: running ? "is-live" : "is-wait", label: STATE_FR[state] ?? state };

  return (
    <div className="race-console lr">
      <header className="race-console-header">
        <div>
          <span className="race-live"><i /> COURSE EN DIRECT</span>
          <h1>{onTrack && race?.raceName ? race.raceName : "RACE CONTROL"}</h1>
          <p>MegaKart Timing Control · {drivers.length} pilote{drivers.length > 1 ? "s" : ""} · classement au meilleur tour</p>
        </div>
        <div className="lr-actions">
          <span className={"lr-pill " + (view.online ? "is-ok" : "is-bad")}><i /> CHRONO</span>
          <span className={"lr-pill " + (view.health?.comConnected ? "is-ok" : "is-bad")} title="Le boîtier ActiveBox sur COM3"><i /> COM3</span>
          <span className={"lr-pill lr-state " + badge.cls}><i /> {badge.label}</span>
          <button type="button" className="lr-btn" onClick={onOpenControls} title="Préparer, lancer ou terminer une course (page Sessions)">
            <SlidersHorizontal size={14} /> Contrôle de course
          </button>
          <button type="button" className="lr-btn is-lime" onClick={() => window.open("/#ecran", "megakart-ecran")}>
            <MonitorPlay size={14} /> Écran géant
          </button>
        </div>
      </header>

      {!view.online ? (
        <div className="lr-banner is-bad">
          <AlertTriangle size={16} />
          <span><b>MegaKart Timing Control ne répond pas.</b> Ouvrez-le sur le PC du chrono (raccourci bureau) : la course s’affichera ici toute seule.</span>
        </div>
      ) : view.health && !view.health.comConnected ? (
        <div className="lr-banner is-warn">
          <AlertTriangle size={16} />
          <span><b>Le boîtier ActiveBox (COM3) n’est pas connecté.</b> Aucun passage ne sera compté tant qu’il ne l’est pas : vérifiez le câble USB puis Timing Control.</span>
        </div>
      ) : null}
      {stalled.length > 0 ? (
        <div className="lr-banner is-warn">
          <AlertTriangle size={16} />
          <span><b>Pas de passage depuis longtemps :</b> {stalled.map((r) => `kart ${r.driver.kart} (${r.driver.driver}, ${fmtSince(r.sincePassS)})`).join(" · ")}. Kart arrêté, au stand, ou transpondeur à vérifier.</span>
        </div>
      ) : null}

      <section className="lr-strip" aria-label="Résumé de la course">
        <div className="lr-tile lr-clock">
          <span><Timer size={13} /> TEMPS RESTANT</span>
          <strong className={running && !armed ? "is-live" : ""}>{onTrack ? fmtClock(race?.remainingMs) : "--:--"}</strong>
          <i className="lr-progress"><i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></i>
          <b>{onTrack && totalMs ? `course de ${Math.round(totalMs / 60_000)} min` : "—"}</b>
        </div>
        <div className="lr-tile is-primary">
          <span><Gauge size={13} /> MEILLEUR TOUR</span>
          <strong>{leader ? fmtLap(leader.driver.bestLapMs) : "—"}</strong>
          <b>{leader ? `${leader.driver.driver} · kart ${leader.driver.kart}` : "pas encore de tour"}</b>
        </div>
        <div className={"lr-tile" + (vsRecord.kind === "beaten" ? " is-record" : "")}>
          <span><Trophy size={13} /> RECORD DE LA PISTE</span>
          <strong>{fmtLap(record.lapMs)}</strong>
          <b>{vsRecord.kind === "beaten" ? `BATTU de ${(vsRecord.gainMs / 1000).toFixed(3)} s !`
            : vsRecord.kind === "behind" ? `à ${(vsRecord.gapMs / 1000).toFixed(3)} s du meilleur tour`
            : record.driver ?? "à battre"}</b>
        </div>
        <div className="lr-tile">
          <span><CalendarDays size={13} /> MEILLEUR DU JOUR</span>
          <strong>{dayBest ? fmtLap(dayBest.lapMs) : "—"}</strong>
          <b>{dayBest ? dayBest.driver : "aucun tour aujourd’hui"}</b>
        </div>
      </section>

      <section className="lr-grid">
        <article className="lr-module lr-map">
          <div className="lr-module-head">
            <div><span>POSITION LIVE</span><h2>Circuit</h2></div>
            <button type="button" className="lr-btn is-small" onClick={() => setEditing((v) => !v)}>
              {editing ? <><X size={13} /> Fermer l’éditeur</> : <><Pencil size={13} /> Ajuster la piste</>}
            </button>
          </div>
          {editing ? trackEditor : (
            <div className="lr-track">
              <LiveTrack
                drivers={(onTrack ? drivers : []) as TrackDriver[]}
                points={route.points}
                start={route.start}
                width={TRACK_WIDTH}
                height={TRACK_HEIGHT}
                running={running && !armed}
              />
              {!onTrack ? <p className="lr-track-note">Les karts apparaissent ici dès qu’une course est envoyée au chrono.</p> : null}
            </div>
          )}
        </article>

        <article className="lr-module lr-board">
          <div className="lr-module-head">
            <div><span>CHRONOMÉTRAGE</span><h2>Classement live</h2></div>
            <b className="lr-count">{onTrack ? drivers.length : 0}</b>
          </div>
          {!onTrack ? (
            <div className="lr-empty">
              <Flag size={24} />
              <strong>{view.online ? "Aucune course sur la piste" : "Chrono hors ligne"}</strong>
              <span>Préparez la course dans Sessions → Contrôle de course : le classement s’affiche ici en direct.</span>
              <button type="button" className="lr-btn" onClick={onOpenControls}><SlidersHorizontal size={14} /> Contrôle de course</button>
            </div>
          ) : (
            <div className="lr-rows" role="list">
              <div className="lr-row lr-row--head"><span>POS</span><span>PILOTE</span><span>DERNIER</span><span>MEILLEUR</span><span>ÉCART</span></div>
              {board.map((r) => {
                const d = r.driver;
                const color = colorOf(d);
                const isSel = selected?.driver.transponder === d.transponder;
                return (
                  <button key={d.transponder} type="button" role="listitem"
                    className={"lr-row" + (isSel ? " is-selected" : "") + (r.stalled ? " is-stalled" : "") + (r.position === 1 ? " is-leader" : "")}
                    style={{ "--pilot": color ? PILOT_HEX[color] ?? "#d8ff35" : "#d8ff35" } as CSSProperties}
                    onClick={() => setPicked(d.transponder)}>
                    <strong className="lr-pos">{r.position ?? "—"}</strong>
                    <span className="lr-who">
                      {color ? <DriverAvatar pilot={color} seed={d.driver} size="28px" /> : null}
                      <span>
                        <b>{d.driver}</b>
                        <small>
                          KART {d.kart} · {d.laps} tour{d.laps > 1 ? "s" : ""}
                          {r.stalled ? <em> · arrêté ? {fmtSince(r.sincePassS)}</em> : r.sincePassS != null && running ? ` · passé il y a ${fmtSince(r.sincePassS)}` : ""}
                        </small>
                      </span>
                    </span>
                    <span className={"lr-time" + (r.personalBest ? " is-pb" : "")}>{fmtLap(d.lastLapMs)}</span>
                    <span className="lr-time is-best">{fmtLap(d.bestLapMs)}</span>
                    <span className="lr-gap">{r.position === 1 ? "EN TÊTE" : fmtGap(r.gapMs)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </article>
      </section>

      {onTrack && selected ? <DriverFocus row={selected} color={colorOf(selected.driver)} recordMs={record.lapMs} /> : null}

      {!onTrack || state === "FINISHED" ? (
        last ? (
          <section className="lr-module lr-last">
            <div className="lr-module-head">
              <div><span>DERNIÈRE COURSE</span><h2>{last.name?.trim() || last.raceId}</h2></div>
              <small className="lr-muted">
                {new Date(endedAt(last) * 1000).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </small>
            </div>
            <div className="lr-podium">
              {byBestLap(last.racers).slice(0, 3).map((d, i) => (
                <div key={d.transponder || d.driver} className={`lr-step is-p${i + 1}`}>
                  <span>{i + 1}</span>
                  <DriverAvatar pilot={last.kartMapping?.[d.transponder]?.color ?? null} seed={d.driver} size="34px" />
                  <b>{d.driver}</b>
                  <small>{fmtLap(d.bestLapMs)} · kart {d.kart}</small>
                </div>
              ))}
            </div>
            <div className="lr-last-actions">
              <button type="button" className="lr-btn" onClick={() => showResultOnBigScreen(souvenirFromSavedRace(last))}>
                <Trophy size={14} /> Podium sur l’écran TV
              </button>
              <button type="button" className="lr-btn" onClick={() => setBlocked(!printTimings(last, byBestLap(last.racers), { record }))}>
                <Printer size={14} /> Imprimer les temps
              </button>
            </div>
            {blocked ? <p className="lr-muted" style={{ color: "#ff9795" }}>Le navigateur a bloqué la fenêtre d’impression : autorisez les pop-up pour ce site.</p> : null}
          </section>
        ) : null
      ) : null}
    </div>
  );
}

function DriverFocus({ row, color, recordMs }: { row: ReturnType<typeof liveBoard>[number]; color: number | null; recordMs: number }) {
  const d = row.driver;
  const laps = hasLapList(d) ? lapRows(d) : [];
  const avg = averageLap(d.lapTimesMs);
  // Bars from the best lap (tallest) to the slowest: the shape of a driver's race at a glance.
  const slowest = laps.reduce((m, l) => Math.max(m, l.ms), 0);
  const best = d.bestLapMs ?? 0;
  const span = Math.max(1, slowest - best);
  const toRecord = d.bestLapMs != null ? d.bestLapMs - recordMs : null;
  return (
    <section className="lr-module lr-focus" style={{ "--pilot": color ? PILOT_HEX[color] ?? "#d8ff35" : "#d8ff35" } as CSSProperties}>
      <div className="lr-module-head">
        <div><span>PILOTE SÉLECTIONNÉ</span><h2>{d.driver}</h2></div>
        <strong className="lr-kart">KART {d.kart}</strong>
      </div>
      <div className="lr-focus-body">
        <dl className="lr-facts">
          <div><dt>Position</dt><dd>{row.position != null ? `P${row.position}` : "—"}</dd></div>
          <div><dt>Meilleur</dt><dd className="is-lime">{fmtLap(d.bestLapMs)}</dd></div>
          <div><dt>Dernier</dt><dd>{fmtLap(d.lastLapMs)}</dd></div>
          <div><dt>Moyenne</dt><dd>{fmtLap(avg)}</dd></div>
          <div><dt>Tours</dt><dd>{d.laps}</dd></div>
          <div><dt>Record</dt><dd>{toRecord == null ? "—" : toRecord < 0 ? "BATTU !" : `+${(toRecord / 1000).toFixed(3)}`}</dd></div>
        </dl>
        {laps.length === 0 ? (
          <p className="lr-muted">{hasLapList(d) ? "Pas encore de tour complet." : "Ce chrono n’envoie pas le détail des tours."}</p>
        ) : (
          <div className="lr-laps">
            <div className="lr-bars" aria-hidden="true">
              {laps.map((l) => (
                <i key={l.lap} className={l.best ? "is-best" : ""} title={`T${l.lap} · ${fmtLap(l.ms)}`}
                  style={{ height: `${28 + 72 * (1 - (l.ms - best) / span)}%` }} />
              ))}
            </div>
            <div className="lr-lap-list">
              {laps.map((l) => (
                <span key={l.lap} className={l.best ? "is-best" : ""}>
                  <small>T{l.lap}</small><b>{fmtLap(l.ms)}</b><em>{l.delta ?? "meilleur"}</em>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
