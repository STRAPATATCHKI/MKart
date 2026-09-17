"use client";

// Big-screen ("écran géant") leaderboard for the venue TV. Shows the live Apex timing feed
// when a session is running, and can run a full race simulation: start lights → race with
// live re-ordering → chequered flag → podium reveal.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ChevronsDown, ChevronsUp, Crown, Flag, Maximize, Minimize, Play, Radio, RotateCcw, Timer, Trophy,
  Volume2, VolumeX, X, Zap,
} from "lucide-react";
import { useLiveRace } from "@/hooks/use-live-race";
import { useActiveRoster } from "@/hooks/use-sessions";
import { Lockup } from "./lockup";
import { DriverAvatar } from "./driver-avatar";
import { Podium } from "./podium";
import { useRaceSound } from "./race-sound";
import { SouvenirQr } from "./souvenir-qr";
import { rowsFromSouvenir } from "./result-rows";
import { createSimulation, fmtClock, simulationResults, simulationRows, stepSimulation, type BoardRow, type RaceEvent, type SimState } from "./race-simulation";
import type { HistorySession } from "@/hooks/use-history";
import { BRIDGE_URL } from "@/lib/bridge-client";
import { MEGAKART_TRACK, souvenirFromHistory, souvenirUrl, type RaceSouvenir } from "@/lib/race-souvenir";
import { listenForScreenCommands } from "@/lib/screen-channel";

const SIM_LAPS = 8;
const SIM_SPEED = 9; // simulated ms per real ms → an 8-lap race lasts ~40 s on screen
const INTRO_MS = 3600;
const FONT_HREF = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;0,900;1,700;1,800;1,900&display=swap";

type Phase = "intro" | "board" | "countdown" | "racing" | "finish" | "podium";
type FeedKind = "up" | "best" | "lap" | "flag" | "go" | "leader";
type FeedItem = { id: number; kind: FeedKind; text: string; time: string };
type Banner = { id: number; kind: "best" | "lap" | "flag" | "leader"; title: string; detail: string };
type Move = { dir: "up" | "down"; token: number };

const FEED_ICONS = { up: ChevronsUp, best: Zap, lap: Timer, flag: Flag, go: Play, leader: Crown };

const parseLap = (value: string) => {
  if (!value || value === "—") return null;
  const [min, sec] = value.includes(":") ? value.split(":") : ["0", value];
  const ms = Number(min) * 60_000 + Number(sec) * 1000;
  return Number.isFinite(ms) ? ms : null;
};

export function BigScreen({ onExit }: { onExit?: () => void }) {
  const roster = useActiveRoster();
  const live = useLiveRace(roster);

  const [phase, setPhase] = useState<Phase>("intro");
  const [source, setSource] = useState<"live" | "sim">("live");
  const [runId, setRunId] = useState(0);
  const [simRows, setSimRows] = useState<BoardRow[]>([]);
  const [simDone, setSimDone] = useState(false);
  const [clock, setClock] = useState(0);
  const [lights, setLights] = useState(0);
  const [showGo, setShowGo] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [moves, setMoves] = useState<Record<string, Move>>({});
  const [muted, setMuted] = useState(false);
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [simSouvenir, setSimSouvenir] = useState<string | null>(null);
  // Official classification saved by the bridge for the live race that just finished.
  const [liveResult, setLiveResult] = useState<{ id: string; race: RaceSouvenir; url: string } | null>(null);
  // A past race the dashboard asked this screen to show ("Afficher le podium sur l'écran géant").
  const [shownResult, setShownResult] = useState<{ race: RaceSouvenir; url: string | null } | null>(null);

  const sound = useRaceSound(muted);
  const simRef = useRef<SimState | null>(null);
  const timers = useRef<number[]>([]);
  const prevRanks = useRef(new Map<string, number>());
  const liveBest = useRef<number | null>(null);
  const liveStatus = useRef(live.status);
  const ids = useRef(0);

  const later = (fn: () => void, ms: number) => {
    const timer = window.setTimeout(() => {
      timers.current = timers.current.filter((t) => t !== timer);
      fn();
    }, ms);
    timers.current.push(timer);
  };
  const clearTimers = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };

  const liveRows = useMemo<BoardRow[]>(
    () =>
      [...live.drivers].sort((a, b) => a.rank - b.rank).map((d, i) => ({
        id: d.transponder !== "—" ? d.transponder : `kart-${d.kart}`,
        rank: i + 1,
        name: d.name,
        kart: d.kart,
        laps: d.laps,
        last: d.last,
        best: d.best,
        bestMs: parseLap(d.best),
        gap: i === 0 ? "LEADER" : d.gap,
        total: "—",
        finished: live.status === "finished",
        lapProgress: 0,
        pilot: d.pilot,
      })),
    [live.drivers, live.status],
  );

  const rows = source === "sim" ? simRows : liveRows;
  const leader = rows[0] ?? null;
  const bestMs = rows.reduce<number | null>((min, r) => (r.bestMs != null && (min == null || r.bestMs < min) ? r.bestMs : min), null);
  const bestRow = rows.find((r) => r.bestMs != null && r.bestMs === bestMs) ?? null;
  const raceOver = source === "sim" ? simDone : live.status === "finished" && rows.length > 0;
  // Read the sim ref rather than `source`: callbacks scheduled from startSimulation close over the pre-sim render.
  const stamp = () => (simRef.current ? fmtClock(simRef.current.clock) : new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));

  const pushFeed = (kind: FeedKind, text: string) =>
    setFeed((items) => [{ id: ++ids.current, kind, text, time: stamp() }, ...items].slice(0, 7));

  const showBanner = (kind: Banner["kind"], title: string, detail: string) => {
    const id = ++ids.current;
    setBanner({ id, kind, title, detail });
    later(() => setBanner((b) => (b?.id === id ? null : b)), 2900);
  };

  const handleEvent = (event: RaceEvent) => {
    switch (event.kind) {
      case "overtake":
        pushFeed(event.rank === 1 ? "leader" : "up", `${event.driver} passe ${event.passed} · P${event.rank}`);
        if (event.rank === 1) { showBanner("leader", "NOUVEAU LEADER", event.driver); sound.leader(); }
        break;
      case "best":
        pushFeed("best", `Meilleur tour · ${event.driver} · ${event.time}`);
        showBanner("best", "MEILLEUR TOUR", `${event.driver} · ${event.time}`);
        sound.best();
        break;
      case "lastlap":
        pushFeed("lap", `Dernier tour · ${event.driver} en tête`);
        showBanner("lap", "DERNIER TOUR", "Tout se joue maintenant");
        sound.bell();
        break;
      case "flag":
        pushFeed("flag", `Drapeau à damier · victoire de ${event.driver}`);
        showBanner("flag", "DRAPEAU À DAMIER", `${event.driver} remporte la course`);
        sound.flag();
        break;
    }
  };

  const resetBoard = () => {
    clearTimers();
    prevRanks.current = new Map();
    setMoves({});
    setFeed([]);
    setBanner(null);
    setLights(0);
    setShowGo(false);
    setSimSouvenir(null);
    setShownResult(null);
    setRunId((n) => n + 1);
  };

  const showResult = (race: RaceSouvenir) => {
    resetBoard();
    simRef.current = null;
    setSimDone(false);
    setSource("live");
    setShownResult({ race, url: null });
    setPhase("podium");
    void souvenirUrl(race).then((url) => setShownResult((current) => (current?.race === race ? { race, url } : current)));
  };

  const startSimulation = () => {
    resetBoard();
    sound.unlock();
    const sim = createSimulation(SIM_LAPS);
    simRef.current = sim;
    setSource("sim");
    setSimDone(false);
    setSimRows(simulationRows(sim));
    setClock(0);
    setPhase("countdown");
    for (let i = 1; i <= 5; i++) later(() => { setLights(i); sound.light(); }, 700 + i * 850);
    const goAt = 700 + 5 * 850 + 600 + Math.random() * 900;
    later(() => {
      setLights(0);
      setShowGo(true);
      setPhase("racing");
      sound.go();
      pushFeed("go", "Feux éteints · la course est lancée");
    }, goAt);
    later(() => setShowGo(false), goAt + 1300);
  };

  const goLive = () => {
    resetBoard();
    simRef.current = null;
    setSimDone(false);
    setSource("live");
    setPhase("board");
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const exit = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    onExit?.();
  };

  // Intro → board, display font, fullscreen tracking, clock, timer cleanup.
  useEffect(() => {
    const introTimer = window.setTimeout(() => setPhase((p) => (p === "intro" ? "board" : p)), INTRO_MS);
    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      document.head.appendChild(link);
    }
    const onFullscreen = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreen);
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    const pending = timers.current;
    return () => {
      window.clearTimeout(introTimer);
      window.clearInterval(tick);
      document.removeEventListener("fullscreenchange", onFullscreen);
      pending.forEach((t) => window.clearTimeout(t));
      timers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // Hide controls and cursor after a few seconds without the mouse — it's a TV.
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), 3000);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 3000);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
    };
  }, []);

  // Simulation loop.
  useEffect(() => {
    if (phase !== "racing" || source !== "sim") return;
    let last = performance.now();
    const loop = window.setInterval(() => {
      const sim = simRef.current;
      if (!sim || sim.done) return;
      const t = performance.now();
      const { events } = stepSimulation(sim, Math.min(250, t - last) * SIM_SPEED);
      last = t;
      setSimRows(simulationRows(sim));
      setClock(sim.clock);
      events.forEach(handleEvent);
      if (sim.done) {
        setSimDone(true);
        const token = runId;
        void souvenirUrl({
          id: `SIM-${Date.now().toString(36).toUpperCase()}`,
          finishedAt: new Date().toISOString(),
          kind: "simulation",
          track: MEGAKART_TRACK,
          drivers: simulationResults(sim),
        }).then((url) => { if (simRef.current === sim && token === runId) setSimSouvenir(url); });
        later(() => { setPhase("finish"); sound.fanfare(); }, 1700);
      }
    }, 100);
    return () => window.clearInterval(loop);
    // handleEvent/later only touch state setters and refs, so the loop can capture them once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, source, runId]);

  // Position changes → row flashes (both sources); live feed also gets its own callouts.
  useEffect(() => {
    const next: Record<string, Move> = {};
    for (const row of rows) {
      const before = prevRanks.current.get(row.id);
      if (before == null || before === row.rank) continue;
      const move = { dir: row.rank < before ? "up" : "down", token: ++ids.current } as const;
      next[row.id] = move;
      later(() => setMoves((m) => {
        if (m[row.id]?.token !== move.token) return m;
        const rest = { ...m };
        delete rest[row.id];
        return rest;
      }), 2200);
      if (source === "live" && row.rank < before) pushFeed(row.rank === 1 ? "leader" : "up", `${row.name} gagne une place · P${row.rank}`);
    }
    prevRanks.current = new Map(rows.map((r) => [r.id, r.rank]));
    // Rows come from the sim timer or the external live feed; flashing the rows that moved is a reaction to that data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Object.keys(next).length) setMoves((m) => ({ ...m, ...next }));

    if (source === "live" && bestMs != null && bestRow) {
      if (liveBest.current != null && bestMs < liveBest.current) {
        pushFeed("best", `Meilleur tour · ${bestRow.name} · ${bestRow.best}`);
        showBanner("best", "MEILLEUR TOUR", `${bestRow.name} · ${bestRow.best}`);
        sound.best();
      }
      liveBest.current = bestMs;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Live session lifecycle: chequered flag → finish screen; a new session → back to the board.
  useEffect(() => {
    if (source !== "live") return;
    const previous = liveStatus.current;
    liveStatus.current = live.status;
    if (previous !== "finished" && live.status === "finished" && live.drivers.length && phase === "board") {
      setPhase("finish");
      sound.flag();
    }
    if (previous !== "running" && live.status === "running") {
      liveBest.current = null;
      // A new session started on the timing system (external) — leave the finish/podium screens.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (phase === "finish" || phase === "podium") setPhase("board");
    }
  }, [live.status, live.drivers.length, source, phase, sound]);

  // Live race archived by the bridge → load its official classification for the podium and QR.
  const liveMaxLaps = live.drivers.reduce((max, d) => Math.max(max, d.laps), 0);
  const liveDriverCount = live.drivers.length;
  const archiveId = source === "live" && live.status === "finished" ? live.lastArchive?.id ?? null : null;
  useEffect(() => {
    if (!archiveId || liveResult?.id === archiveId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${BRIDGE_URL}/history`, { cache: "no-store" });
        const history = (await res.json()) as HistorySession[];
        const entry = Array.isArray(history) ? history.find((h) => h.id === archiveId) : undefined;
        // Only trust the archive if it is this race: the end marker can arrive after the last passing,
        // and until then lastArchive still points at the previous session.
        if (!entry || (liveDriverCount > 0 && (entry.drivers.length !== liveDriverCount || entry.laps !== liveMaxLaps))) return;
        const race = souvenirFromHistory(entry);
        const url = await souvenirUrl(race);
        if (!cancelled) setLiveResult({ id: entry.id, race, url });
      } catch {
        /* bridge unreachable: the podium falls back to the live rows, without a QR code */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [archiveId, liveDriverCount, liveMaxLaps, liveResult?.id]);

  // Commands from the dashboard (same PC): show a past race's podium and souvenir QR.
  const commandHandler = useRef<(race: RaceSouvenir) => void>(() => {});
  useEffect(() => {
    commandHandler.current = showResult;
  });
  useEffect(() => listenForScreenCommands((command) => commandHandler.current(command.race)), []);

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = (e) => {
      const key = e.key.toLowerCase();
      if (e.target instanceof HTMLButtonElement && (key === " " || key === "enter")) return;
      if (key === " " || key === "s") {
        e.preventDefault();
        if (phase !== "countdown" && phase !== "racing") startSimulation();
      } else if (key === "p" && raceOver) setPhase("podium");
      else if (key === "f") toggleFullscreen();
      else if (key === "m") setMuted((m) => !m);
      else if (key === "l") goLive();
      else if (key === "escape" && (phase === "podium" || phase === "finish")) setPhase("board");
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lapLabel = source === "sim"
    ? { now: simDone ? SIM_LAPS : Math.min((leader?.laps ?? 0) + 1, SIM_LAPS), total: SIM_LAPS }
    : { now: rows.reduce((max, r) => Math.max(max, r.laps), 0), total: null };

  const status = source === "sim"
    ? { countdown: { cls: "is-red", text: "DÉPART IMMINENT" }, racing: { cls: "is-live", text: "SIMULATION EN COURSE" }, finish: { cls: "is-flag", text: "COURSE TERMINÉE" }, podium: { cls: "is-flag", text: "COURSE TERMINÉE" }, board: { cls: simDone ? "is-flag" : "", text: simDone ? "COURSE TERMINÉE" : "SIMULATION" }, intro: { cls: "", text: "SIMULATION" } }[phase]
    : {
        running: { cls: "is-live", text: "EN DIRECT" },
        finished: { cls: "is-flag", text: "SESSION TERMINÉE" },
        waiting: { cls: "", text: "EN ATTENTE DU DÉPART" },
        idle: { cls: "", text: "FEED CONNECTÉ" },
        offline: { cls: "is-off", text: "CHRONO HORS LIGNE" },
      }[live.status];

  const wheelSpin = phase === "racing" || (source === "live" && live.status === "running") ? ".42s" : "2.6s";
  const subtitle = `MEGAKART FÈS · ${
    source === "sim" ? "SIMULATION" : shownResult ? "RÉSULTATS" : live.megakartSession?.name ? live.megakartSession.name.toUpperCase() : "EN DIRECT"
  }`;
  // What the finish card and podium show: a race pushed from the dashboard, else the official
  // archive of the live race that just finished, else the rows on the board.
  const officialLive = liveResult && source === "live" && live.status === "finished" && live.lastArchive?.id === liveResult.id ? liveResult : null;
  const resultRace = shownResult?.race ?? officialLive?.race ?? null;
  const resultRows = useMemo(() => (resultRace ? rowsFromSouvenir(resultRace) : null), [resultRace]);
  const podiumRows = resultRows ?? rows;
  const winner = podiumRows[0] ?? null;
  const souvenirLink = shownResult ? shownResult.url : officialLive ? officialLive.url : source === "sim" && simDone ? simSouvenir : null;
  const stableRows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const rowCount = Math.max(rows.length, 8);

  return (
    <div className={"bs" + (idle ? " is-idle" : "")}>
      <div className="bs-bg" aria-hidden="true" />

      <div className={"bs-screen" + (phase !== "intro" ? " is-ready" : "")}>
        <header className={"bs-header" + (banner ? " has-banner" : "")}>
          <Lockup className="bs-header-lockup" spin={wheelSpin} />
          <div className="bs-title">
            <span className="bs-kicker">{subtitle}</span>
            <h1>CLASSEMENT</h1>
          </div>
          <div className="bs-header-stats">
            <span className={"bs-status " + status.cls}><i />{status.text}</span>
            <div className="bs-stat">
              <small>TOUR</small>
              <b>{lapLabel.now || "—"}{lapLabel.total && <em>/{lapLabel.total}</em>}</b>
            </div>
            <div className="bs-stat">
              <small>{source === "sim" ? "CHRONO" : "HEURE"}</small>
              <b>{source === "sim" ? fmtClock(clock) : now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</b>
            </div>
          </div>
          {banner && (
            <div className="bs-banner-slot">
              <div key={banner.id} className={`bs-banner bs-banner--${banner.kind}`} role="status">
                <b>{banner.title}</b><span>{banner.detail}</span>
              </div>
            </div>
          )}
        </header>

        <main className="bs-main">
          <section className="bs-board" aria-label="Classement">
            <div className="bs-row-head">
              <span>POS</span><span /><span>PILOTE</span><span>TOURS</span><span>DERNIER</span><span>MEILLEUR</span><span>ÉCART</span>
            </div>

            {rows.length === 0 ? (
              <div className="bs-empty">
                <div className="bs-empty-wheel" aria-hidden="true"><i /></div>
                <strong>{live.status === "waiting" ? "DÉPART IMMINENT" : "PROCHAINE COURSE BIENTÔT"}</strong>
                <span>{live.bridgeConnected ? "Le classement s’affichera dès le drapeau vert." : "Chronométrage hors ligne — lancez une simulation pour tester l’écran."}</span>
                <button type="button" className="bs-btn bs-btn--primary bs-btn--lg" onClick={startSimulation}><Play /> Lancer la simulation</button>
              </div>
            ) : (
              <div key={`${source}-${runId}-${phase === "intro" ? "intro" : "on"}`} className="bs-rows" style={{ "--count": rowCount } as CSSProperties}>
                {stableRows.map((row) => {
                  const move = moves[row.id]?.dir ?? null;
                  const isBest = row.bestMs != null && row.bestMs === bestMs;
                  return (
                    <div
                      key={row.id}
                      className={`bs-row bs-row--p${Math.min(row.rank, 4)}` + (move ? ` is-${move}` : "") + (row.finished ? " is-finished" : "")}
                      style={{ "--pos": row.rank - 1 } as CSSProperties}
                    >
                      <div className="bs-row-inner">
                        <div className="bs-pos">{row.rank}</div>
                        <div className="bs-move">{move === "up" ? <ChevronsUp /> : move === "down" ? <ChevronsDown /> : null}</div>
                        <div className="bs-driver">
                          <i className="bs-avatar bs-avatar--kart"><DriverAvatar pilot={row.pilot} seed={row.name} /></i>
                          <div><b>{row.name}</b><small>KART {row.kart}</small></div>
                          {row.finished && <Flag className="bs-finished-flag" aria-label="Arrivé" />}
                        </div>
                        <div className="bs-cell">{row.laps}</div>
                        <div className="bs-cell bs-muted">{row.last}</div>
                        <div className={"bs-cell bs-best" + (isBest ? " is-best" : "")}>{isBest && <Zap />}{row.best}</div>
                        <div className={"bs-cell bs-gap" + (row.rank === 1 ? " is-leader" : "")}>{row.gap}</div>
                        {source === "sim" && <div className="bs-lapbar"><i style={{ transform: `scaleX(${row.lapProgress})` }} /></div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </section>

          <aside className="bs-side">
            <article className="bs-card bs-leader">
              <span className="bs-card-label"><Crown /> EN TÊTE</span>
              {leader ? (
                <>
                  <strong key={leader.id}>{leader.name}</strong>
                  <small>KART {leader.kart} · {leader.laps} TOUR{leader.laps > 1 ? "S" : ""}</small>
                  <div className="bs-leader-gap"><em>ÉCART P2</em><b>{rows[1]?.gap ?? "—"}</b></div>
                </>
              ) : (
                <strong className="bs-dim">—</strong>
              )}
              <div className="bs-leader-wheel" style={{ "--spin": wheelSpin } as CSSProperties} aria-hidden="true"><i /></div>
            </article>

            <article className="bs-card bs-bestlap">
              <span className="bs-card-label"><Zap /> MEILLEUR TOUR</span>
              <strong key={bestMs ?? "none"}>{bestRow ? bestRow.best : "—"}</strong>
              <small>{bestRow ? `${bestRow.name} · KART ${bestRow.kart}` : "En attente du premier tour"}</small>
            </article>

            <article className="bs-card bs-feed">
              <span className="bs-card-label"><Radio /> RACE FEED</span>
              <ul>
                {feed.length === 0 && <li className="bs-feed-empty">Les dépassements et records apparaîtront ici.</li>}
                {feed.map((item) => {
                  const Icon = FEED_ICONS[item.kind];
                  return (
                    <li key={item.id} className={`bs-feed-item bs-feed--${item.kind}`}>
                      <i><Icon /></i><span>{item.text}</span><time>{item.time}</time>
                    </li>
                  );
                })}
              </ul>
            </article>
          </aside>
        </main>

        <footer className="bs-ticker" aria-hidden="true">
          <b>MEGAKART FÈS</b>
          <div className="bs-checker" />
          <div className="bs-marquee">
            {[0, 1].map((copy) => (
              <span key={copy}>
                CLASSEMENT OFFICIEL <i /> RÉSERVEZ VOTRE PROCHAINE SESSION <i /> BATTEZ LE MEILLEUR TOUR <i /> GOOD GAME À TOUS LES PILOTES <i /> MEGAKART FÈS <i />
              </span>
            ))}
          </div>
        </footer>
      </div>

      {phase === "countdown" && (
        <div className="bs-countdown" role="status" aria-live="assertive">
          <span className="bs-kicker">GRILLE DE DÉPART · {SIM_LAPS} TOURS</span>
          <div className="bs-lights">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className={"bs-light" + (lights >= n ? " is-on" : "")}><i /><i /></div>
            ))}
          </div>
          <strong>PRÉPAREZ-VOUS</strong>
        </div>
      )}
      {showGo && <div className="bs-go" aria-hidden="true">GO!</div>}

      {phase === "finish" && winner && (
        <div className="bs-finish" role="dialog" aria-label="Course terminée">
          <div className="bs-finish-flag" aria-hidden="true" />
          <div className={"bs-finish-card" + (souvenirLink ? " has-qr" : "")}>
            <div className="bs-finish-main">
              <Lockup className="bs-finish-lockup" spin="1.2s" />
              <span className="bs-kicker"><Flag /> ARRIVÉE{source === "sim" ? ` · ${SIM_LAPS} TOURS` : ""}</span>
              <h2>COURSE TERMINÉE</h2>
              <p>VAINQUEUR</p>
              <strong>{winner.name}</strong>
              <small>KART {winner.kart} · MEILLEUR TOUR {winner.best}</small>
              <div className="bs-finish-actions">
                <button type="button" className="bs-btn bs-btn--primary bs-btn--xl" onClick={() => setPhase("podium")} autoFocus>
                  <Trophy /> Afficher le podium
                </button>
                <button type="button" className="bs-btn bs-btn--lg" onClick={() => setPhase("board")}>Voir le classement</button>
              </div>
            </div>
            {souvenirLink && <SouvenirQr url={souvenirLink} className="bs-finish-qr" />}
          </div>
        </div>
      )}

      {phase === "podium" && (
        <Podium
          key={runId}
          rows={podiumRows}
          subtitle={subtitle}
          sound={sound}
          souvenirUrl={souvenirLink}
          onBack={() => {
            setShownResult(null);
            setPhase("board");
          }}
          onReplay={startSimulation}
        />
      )}

      {phase === "board" && raceOver && (
        <button type="button" className="bs-btn bs-btn--primary bs-btn--lg bs-podium-fab" onClick={() => setPhase("podium")}>
          <Trophy /> Podium
        </button>
      )}

      <div className={"bs-intro" + (phase === "intro" ? " is-on" : "")} onClick={() => setPhase("board")} aria-hidden={phase !== "intro"}>
        <div className="bs-intro-lockup">
          <Lockup className="bs-lockup--xl" spin=".38s" />
          <i className="bs-intro-shine" />
        </div>
        <div className="bs-intro-title"><span>CLASSEMENT OFFICIEL</span><b>ÉCRAN GÉANT</b></div>
        <div className="bs-intro-bar"><i /></div>
      </div>

      <nav className="bs-controls" aria-label="Commandes de l’écran">
        <button type="button" className="bs-btn bs-btn--primary" onClick={startSimulation} disabled={phase === "countdown" || phase === "racing"}>
          {source === "sim" && simDone ? <RotateCcw /> : <Play />} {source === "sim" && simDone ? "Rejouer" : "Simulation"} <kbd>Espace</kbd>
        </button>
        <button type="button" className="bs-btn" onClick={() => setPhase("podium")} disabled={!raceOver || phase === "podium"}>
          <Trophy /> Podium <kbd>P</kbd>
        </button>
        <button type="button" className={"bs-btn" + (source === "live" ? " is-active" : "")} onClick={goLive}>
          <Radio /> Direct <kbd>L</kbd>
        </button>
        <button type="button" className="bs-btn bs-btn--icon" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Activer le son" : "Couper le son"}>
          {muted ? <VolumeX /> : <Volume2 />}
        </button>
        <button type="button" className="bs-btn bs-btn--icon" onClick={toggleFullscreen} aria-label="Plein écran">
          {fullscreen ? <Minimize /> : <Maximize />}
        </button>
        {onExit && (
          <button type="button" className="bs-btn bs-btn--icon" onClick={exit} aria-label="Retour au dashboard">
            <X />
          </button>
        )}
      </nav>
    </div>
  );
}
