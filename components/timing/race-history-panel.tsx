"use client";

// COURSES TERMINÉES — the races the chrono has already saved.
//
// It sits directly under the race deck because that is where the operator is standing when they
// press « Session suivante »: the race they just ran leaves the deck at that moment, and this is
// where they turn to find it again. Newest first, one line each, and the laps only when asked.
import { AlertTriangle, ChevronDown, ChevronRight, History } from "lucide-react";
import { Fragment, useState } from "react";

/** How many races the panel lists before asking. */
const PAGE = 12;
import { DriverAvatar } from "@/components/big-screen/driver-avatar";
import { fmtLap, hasLapList, lapRows } from "@/components/timing/lap-rows";
import { bestLap, classification, pilotLabel, type RaceSummary } from "@/components/timing/race-summaries";
import type { RaceHistoryView } from "@/hooks/use-race-history";
import type { TimingSavedRace } from "@/lib/timing-client";

export function RaceHistoryPanel({ history }: { history: RaceHistoryView }) {
  // One race open at a time: an evening holds a dozen results and every one of them unfolds into
  // a classification plus its laps, which would bury the deck above if they all stayed open.
  const [openId, setOpenId] = useState<string | null>(null);
  // Enough to cover a busy evening without turning the Sessions page into a scroll.
  const [shown, setShown] = useState(PAGE);

  const toggle = (raceId: string) => {
    const next = openId === raceId ? null : raceId;
    setOpenId(next);
    if (next) history.open(next);
  };

  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-header">
        <div><span className="panel-kicker">CHRONO MEGAKART</span><h2>Courses terminées</h2></div>
        {history.online && history.loaded && history.races.length > 0 ? (
          <small style={{ color: "#8aa0b6" }}>{history.races.length} enregistrée{history.races.length > 1 ? "s" : ""}</small>
        ) : null}
      </div>

      {!history.loaded ? (
        <div className="empty-state" style={{ padding: "22px 18px" }}><span>Lecture des courses enregistrées…</span></div>
      ) : !history.online ? (
        <div className="empty-state" style={{ padding: "22px 18px" }}>
          <strong>MegaKart Timing Control ne répond pas</strong>
          <span>Les résultats sont enregistrés sur le PC du chrono : ouvrez-le pour les consulter.</span>
        </div>
      ) : history.races.length === 0 ? (
        <div className="empty-state" style={{ padding: "22px 18px" }}>
          <History size={20} /><strong>Aucune course enregistrée</strong>
          <span>Chaque course apparaît ici dès qu’elle est terminée au chrono.</span>
        </div>
      ) : (
        <div className="race-history">
          <div className="race-history-head">
            <span>COURSE</span><span>FIN</span><span>DURÉE</span><span>PILOTES</span>
          </div>
          {history.races.slice(0, shown).map((r) => {
            const open = openId === r.raceId;
            return (
              <Fragment key={r.raceId}>
                <button type="button" className={"race-history-row" + (open ? " is-open" : "")}
                  aria-expanded={open} onClick={() => toggle(r.raceId)}
                  title={open ? "Masquer le classement" : "Voir le classement et les tours"}>
                  <span className="race-history-name">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <b>{r.title}</b>
                    {r.simulated ? <em className="race-history-sim">SIMULATION</em> : null}
                    {/* Saved while still RUNNING - the chrono was closed mid-race. It is a
                        partial record, and must not read as a result. */}
                    {r.finished ? null : <em className="race-history-partial">INCOMPLÈTE</em>}
                    <small>{r.raceId}</small>
                  </span>
                  <span>{r.when}</span>
                  {/* A race that was never timed shows the slot it was booked for, said plainly:
                      eight minutes of booking is not eight minutes of racing. */}
                  <span style={{ fontFamily: "monospace" }}>
                    {r.duration}{r.measured || r.duration === "—" ? null : <small style={{ fontFamily: "inherit" }}> prévu</small>}
                  </span>
                  <span>{pilotLabel(r.racers)}</span>
                </button>
                {open ? <div className="race-history-detail"><RaceDetail summary={r} state={history.details[r.raceId]} /></div> : null}
              </Fragment>
            );
          })}
          {/* A season's races would otherwise be one long wall between the deck and the
              sessions list below it. The newest are what anyone is looking for. */}
          {history.races.length > shown ? (
            <button type="button" className="race-history-more" onClick={() => setShown((n) => n + PAGE)}>
              Voir les {Math.min(PAGE, history.races.length - shown)} courses précédentes
              <small> · {history.races.length - shown} de plus</small>
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function RaceDetail({ summary, state }: { summary: RaceSummary; state: RaceHistoryView["details"][string] | undefined }) {
  if (!state || state.status === "loading") return <span className="race-history-note">Chargement du détail…</span>;
  if (state.status === "error") {
    return <span className="race-history-note" style={{ color: "#ff6b69" }}>{state.message}</span>;
  }

  const race = state.race;
  const rows = classification(race.racers);
  const fastest = bestLap(race.racers);
  if (rows.length === 0) {
    return <span className="race-history-note">Aucun pilote enregistré pour cette course.</span>;
  }

  return (
    <>
      {summary.simulated ? (
        <p className="race-history-warn"><AlertTriangle size={14} /> Course simulée : aucun kart n’a roulé, ces temps sont générés.</p>
      ) : null}
      {fastest ? (
        <p className="race-history-note">
          Meilleur tour de la course : <b style={{ color: "#d8ff35", fontFamily: "monospace" }}>{fmtLap(fastest.ms)}</b> — {fastest.driver}
        </p>
      ) : null}

      <div className="race-history-grid race-history-grid--head">
        <span>POS</span><span>PILOTE</span><span>KART</span><span>TOURS</span><span>MEILLEUR</span>
      </div>
      {rows.map((d) => {
        const laps = lapRows(d);
        return (
          <div key={d.transponder || `${d.kart}-${d.driver}`}>
            <div className="race-history-grid race-history-driver">
              <strong>{d.position ?? "—"}</strong>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <DriverAvatar pilot={race.kartMapping?.[d.transponder]?.color ?? null} seed={d.driver} size="24px" />
                <span>{d.driver}</span>
              </span>
              <span>{d.kart}</span>
              <strong>{d.laps ?? 0}</strong>
              <span style={{ fontFamily: "monospace", color: "#d8ff35" }}>{fmtLap(d.bestLapMs)}</span>
            </div>
            <LapList driver={d} laps={laps} />
          </div>
        );
      })}
    </>
  );
}

function LapList({ driver, laps }: { driver: TimingSavedRace["racers"][number]; laps: ReturnType<typeof lapRows> }) {
  // A race saved by an older Timing Control kept only the last and best lap, so say that the
  // detail was never recorded rather than claim the pilot did no laps at all.
  if (!hasLapList(driver)) {
    return <span className="race-history-note">Détail des tours non enregistré pour cette course ({driver.laps ?? 0} tour{(driver.laps ?? 0) > 1 ? "s" : ""}).</span>;
  }
  if (laps.length === 0) return <span className="race-history-note">Aucun tour chronométré.</span>;
  return (
    <div className="race-history-laps">
      {laps.map((l) => (
        <span key={l.lap} style={{ color: l.best ? "#d8ff35" : undefined }}>
          <span style={{ minWidth: 26, color: "#8aa0b6" }}>T{l.lap}</span>
          <span>{fmtLap(l.ms)}</span>
          <span style={{ color: l.best ? "#d8ff35" : "#8aa0b6" }}>{l.delta ?? "meilleur"}</span>
        </span>
      ))}
    </div>
  );
}
