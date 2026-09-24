"use client";

// Big-screen ("écran géant") leaderboard for the venue TV. Shows the live Apex timing feed
// when a session is running, and can run a full race simulation: start lights → race with
// live re-ordering → chequered flag → podium reveal.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ChevronsDown, ChevronsUp, Crown, Flag, Maximize, Minimize, Play, Radio, Timer, Trophy,
  TrafficCone, Volume2, VolumeX, X, Zap,
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
import { explainTimingError, timing, TimingOffline } from "@/lib/timing-client";
import { canStart, formatRaceClock, startLightSchedule } from "./start-sequence";
import { avgSpeedKmh, fmtLap, fmtSpeed } from "@/components/timing/lap-rows";
import { IntroTraffic } from "./intro-traffic";
import { useTiming } from "@/hooks/use-timing";
import { useTrackRecord } from "@/hooks/use-track-record";
import { compareToRecord, dayBestLap, fmtRecord } from "@/lib/track-record";
import { useSavedRaces } from "@/hooks/use-saved-races";

const SIM_LAPS = 8;
const SIM_SPEED = 9; // simulated ms per real ms → an 8-lap race lasts ~40 s on screen
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
  // The screen talks to MegaKart Timing Control directly, so the start lights and the chrono
  // that answers them are the same action: no operator has to press two buttons in sync.
  const chrono = useTiming(1000);

  const [phase, setPhase] = useState<Phase>("intro");
  const [source, setSource] = useState<"live" | "sim">("live");
  const [runId, setRunId] = useState(0);
  const [simRows, setSimRows] = useState<BoardRow[]>([]);
  const [simDone, setSimDone] = useState(false);
  const [clock, setClock] = useState(0);
  const [lights, setLights] = useState(0);
  // The start gantry is red while it fills, then the whole bar turns green on GO. Karting
  // customers read "green means go"; F1 lights-out reads as "nothing happened".
  const [lightsGreen, setLightsGreen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
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
  // The track record, to chase: shown in the best-lap card, the ticker, and announced when beaten.
  const { record } = useTrackRecord(60_000);
  // Today's saved races, for "best lap of the day" in each podium souvenir.
  const { races: savedRaces } = useSavedRaces();
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

  // The board reads MegaKart Timing Control, the service that actually runs the races now.
  // The header already did, which is why it could say PRET while the board below it stayed
  // empty: the two halves of this screen were reading two different services. The old Apex
  // bridge feed is kept as the fallback, so a venue still on GoKarts is not left blank.
  const chronoRows = useMemo<BoardRow[]>(() => {
    const drivers = chrono.race?.drivers ?? [];
    if (!drivers.length) return [];
    const ordered = [...drivers].sort((a, b) =>
      (a.position ?? 999) - (b.position ?? 999) || (a.grid ?? 999) - (b.grid ?? 999));
    const leaderLaps = ordered[0]?.laps ?? 0;
    // The chrono already ordered the field by the session's rule; this column only has to say
    // the gap in that rule's currency - laps in a race, seconds in a time trial.
    const chronos = chrono.race?.rankMode === "chronos";
    const fastest = ordered[0]?.bestLapMs ?? null;
    return ordered.map((d, i) => {
      // Before anyone has crossed, every driver is on zero laps: showing "+0 tr" for the whole
      // grid reads as a race in progress. The grid slot is the honest thing to show there.
      const behind = leaderLaps - d.laps;
      let gap: string;
      if (chronos) {
        if (i === 0) gap = fastest != null ? "LEADER" : "GRILLE";
        else if (fastest != null && d.bestLapMs != null) gap = `+${((d.bestLapMs - fastest) / 1000).toFixed(3)}`;
        else gap = d.grid ? `P${d.grid}` : "\u2014";
      } else {
        gap = i === 0
          ? (leaderLaps > 0 ? "LEADER" : "GRILLE")
          : (leaderLaps > 0 ? (behind > 0 ? `+${behind} tr` : "\u2014") : (d.grid ? `P${d.grid}` : "\u2014"));
      }
      return {
        id: d.transponder || `kart-${d.kart}`,
        rank: i + 1,
        name: d.driver,
        kart: String(d.kart),
        laps: d.laps,
        last: fmtLap(d.lastLapMs),
        best: fmtLap(d.bestLapMs),
        bestMs: d.bestLapMs ?? null,
        gap,
        total: "\u2014",
        finished: chrono.race?.state === "FINISHED",
        lapProgress: 0,
        pilot: d.color ?? null,
      } as BoardRow;
    });
  }, [chrono.race]);

  // Timing Control wins whenever it has a field - including a race that is merely PREPARED, so
  // the grid is on the wall before the lights rather than only after the first kart crosses.
  const rows = source === "sim" ? simRows : (chronoRows.length ? chronoRows : liveRows);
  const leader = rows[0] ?? null;
  const bestMs = rows.reduce<number | null>((min, r) => (r.bestMs != null && (min == null || r.bestMs < min) ? r.bestMs : min), null);
  const bestRow = rows.find((r) => r.bestMs != null && r.bestMs === bestMs) ?? null;
  const recordCmp = compareToRecord(bestMs, record);
  const chronoFinished = chrono.race?.state === "FINISHED" && chronoRows.length > 0;
  const raceOver = source === "sim" ? simDone : chronoFinished || (live.status === "finished" && rows.length > 0);

  // PREPARE is what ends the idle screen: the moment there is a field, the board takes over.
  // Anything the operator does by hand (DIRECT, PODIUM, the start lights) also wins, so this
  // only ever pulls the screen OUT of intro, never back into it mid-race.
  useEffect(() => {
    let next: Phase | null = null;
    if (phase === "intro" && (rows.length > 0 || source === "sim")) next = "board";
    else if (phase === "board" && source === "live" && rows.length === 0 && !raceOver) next = "intro";
    if (next === null) return;
    // Deferred a tick rather than set inside the effect body: the change is data-driven, not
    // user-driven, and a frame of delay is invisible on a wall screen.
    const id = window.setTimeout(() => setPhase(next as Phase), 0);
    return () => window.clearTimeout(id);
  }, [phase, rows.length, source, raceOver]);
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

  // Lights the five reds one per beat, then hands over at "go". The caller decides what
  // happens at that instant: a simulation, or the real race.
  const runStartLights = (go: () => void) => {
    setLightsGreen(false);
    setLights(0);
    const { steps, greenAt } = startLightSchedule();
    steps.forEach((step) => later(() => {
      setLights(step.lights);
      setLightsGreen(step.green);
      if (step.at === greenAt) {
        setShowGo(true);
        sound.go();
        go();
      } else if (step.lights > 0) {
        sound.light();
      } else {
        setShowGo(false);            // the green hold is over; the board takes the screen back
      }
    }, step.at));
    return greenAt;
  };

  // The real start. The chrono is armed on "first_crossing", so this releases the pilots and
  // the clock begins on the first transponder to cross - the lights are the human half of it.
  const startRace = async () => {
    if (starting) return;
    setStartError(null);
    const allowed = canStart(chrono.online, chrono.race?.state);
    if (!allowed.ok) return setStartError(allowed.reason);

    setStarting(true);
    sound.unlock();
    resetBoard();
    simRef.current = null;
    setSimDone(false);
    setSource("live");
    setPhase("countdown");
    runStartLights(() => {
      setPhase("racing");
      pushFeed("go", "Feux verts · la course est lancée");
      // Fired at lights-out, not before: a pilot who moves on green must already be timed.
      void timing.start()
        .then((result) => {
          if (!result.success) setStartError(explainTimingError(result.error, result.message));
        })
        .catch((e) => setStartError(e instanceof TimingOffline ? "MegaKart Timing Control ne répond pas." : String(e)))
        .finally(() => { setStarting(false); chrono.refresh(); });
    });
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
    runStartLights(() => {
      setPhase("racing");
      pushFeed("go", "Feux verts · la course est lancée");
    });
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
    // No timer: the intro is the screen the venue looks at between races, so it stays until
    // a race actually exists. Leaving it after a few seconds only ever revealed an empty board
    // saying "prochaine course bientot" - the logo says that better, and looks like something.
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
        const beaten = compareToRecord(bestMs, record).kind === "beaten";
        pushFeed("best", `${beaten ? "NOUVEAU RECORD DE LA PISTE" : "Meilleur tour"} · ${bestRow.name} · ${bestRow.best}`);
        showBanner("best", beaten ? "NOUVEAU RECORD DE LA PISTE" : "MEILLEUR TOUR", `${bestRow.name} · ${bestRow.best}`);
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

  // The chrono's own race ending: the countdown reaches zero (or ARRIVÉE is pressed), the
  // state goes FINISHED, and the wall shows the flag, then the podium, without anyone at the
  // desk having to press anything. A new PREPARE afterwards takes the screen back to the grid.
  const chronoState = chrono.race?.state ?? null;
  const chronoStateWas = useRef<string | null>(null);
  useEffect(() => {
    const previous = chronoStateWas.current;
    chronoStateWas.current = chronoState;
    if (source !== "live") return;
    if (previous !== "FINISHED" && chronoState === "FINISHED" && chronoRows.length > 0
        && (phase === "board" || phase === "racing")) {
      later(() => { setPhase("finish"); sound.flag(); }, 0);
      later(() => { setPhase("podium"); sound.fanfare(); }, 2600);
    }
    if ((previous === "FINISHED" || previous === "IDLE") && (chronoState === "PREPARED" || chronoState === "RUNNING")
        && (phase === "finish" || phase === "podium")) {
      later(() => setPhase("board"), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chronoState, chronoRows.length, source, phase]);

  // The finished race as a souvenir, built from the chrono's classification, so the podium
  // has its QR the moment the flag falls rather than waiting on an archive that may never come.
  const [chronoResult, setChronoResult] = useState<{ id: string; race: RaceSouvenir; url: string } | null>(null);
  const chronoRaceId = chrono.race?.raceId ?? null;
  useEffect(() => {
    if (!chronoFinished || !chronoRaceId || chronoResult?.id === chronoRaceId) return;
    const drivers = [...(chrono.race?.drivers ?? [])].sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    const race: RaceSouvenir = {
      id: chronoRaceId,
      finishedAt: chrono.race?.finishedAt ?? new Date().toISOString(),
      kind: "race",
      track: MEGAKART_TRACK,
      drivers: drivers.map((d) => ({
        name: d.driver, kart: String(d.kart), laps: d.laps, bestLapMs: d.bestLapMs ?? null,
        totalTimeMs: null, pilot: d.color ?? null,
      })),
    };
    // The records as they stand when the flag falls, kept in the link: the phone page compares
    // the pilot's lap with the best of the day and the track record, lower down (never in the story).
    const dayBest = dayBestLap(savedRaces, drivers.map((d) => ({ driver: d.driver, bestLapMs: d.bestLapMs })), record);
    race.records = {
      dayBestMs: dayBest?.lapMs ?? null, dayBestBy: dayBest?.driver ?? null,
      recordMs: record.lapMs, recordBy: record.driver,
    };
    let cancelled = false;
    void souvenirUrl(race).then((url) => { if (!cancelled) setChronoResult({ id: chronoRaceId, race, url }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chronoFinished, chronoRaceId, chronoResult?.id]);

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

  // Commands from the dashboard (same PC): show a past race's podium, or run the start lights.
  // Both go through refs so the listener is bound once and still sees the latest closures.
  const commandHandler = useRef<(race: RaceSouvenir) => void>(() => {});
  const startHandler = useRef<() => boolean>(() => false);
  useEffect(() => {
    commandHandler.current = showResult;
    // Take the start only when it is actually startable here; otherwise say no, and the
    // dashboard arms the chrono itself rather than waiting on lights that will never come.
    startHandler.current = () => {
      if (starting || phase === "countdown") return false;
      if (!canStart(chrono.online, chrono.race?.state).ok) return false;
      void startRace();
      return true;
    };
  });
  // Browsers only let a page make sound after somebody has touched it. The lights are now
  // fired from the dashboard, over the channel, so the TV window itself may never be clicked -
  // and would then run red → green in silence. Any gesture on the TV, ever, unlocks audio for
  // good: the click that dismisses the intro, the fullscreen button, a key. So the first thing
  // to do when setting up the wall is to touch it once.
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [sound]);

  useEffect(() => listenForScreenCommands({
    onShowResult: (command) => commandHandler.current(command.race),
    onStartLights: () => startHandler.current(),
  }), []);

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = (e) => {
      const key = e.key.toLowerCase();
      if (e.target instanceof HTMLButtonElement && (key === " " || key === "enter")) return;
      if (key === "s") {
        e.preventDefault();
        if (phase !== "countdown" && phase !== "racing") startSimulation();
      } else if (key === "d") {
        // The real start, on its own key: never on Space, which is the simulation's.
        e.preventDefault();
        void startRace();
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
  // What the pilots actually want on the wall: the time left in THEIR race, not the hour.
  const raceClock = formatRaceClock(chrono.race);

  const subtitle = `MEGAKART FÈS · ${chrono.race?.rankMode === "chronos" ? "CHRONO · " : ""}${
    source === "sim" ? "SIMULATION" : shownResult ? "RÉSULTATS" : live.megakartSession?.name ? live.megakartSession.name.toUpperCase() : "EN DIRECT"
  }`;
  // What the finish card and podium show: a race pushed from the dashboard, else the official
  // archive of the live race that just finished, else the rows on the board.
  const officialChrono = chronoResult && source === "live" && chronoFinished && chronoResult.id === chronoRaceId ? chronoResult : null;
  const officialLive = officialChrono ?? (liveResult && source === "live" && live.status === "finished" && live.lastArchive?.id === liveResult.id ? liveResult : null);
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
              <small>{source === "sim" ? "CHRONO" : raceClock ? "TEMPS RESTANT" : "HEURE"}</small>
              <b className={raceClock && !raceClock.pending ? "bs-stat--live" : undefined}>
                {source === "sim"
                  ? fmtClock(clock)
                  : raceClock
                    ? raceClock.text
                    : now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </b>
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
                <span>{live.bridgeConnected
                  ? "Le classement s’affichera dès le drapeau vert."
                  : "En attente du chronométrage."}</span>
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

            <article className={"bs-card bs-bestlap" + (recordCmp.kind === "beaten" ? " is-record" : "")}>
              <span className="bs-card-label"><Zap /> {recordCmp.kind === "beaten" ? "NOUVEAU RECORD !" : "MEILLEUR TOUR"}</span>
              <strong key={bestMs ?? "none"}>{bestRow ? bestRow.best : "—"}</strong>
              <small>{bestRow ? `${bestRow.name} · KART ${bestRow.kart}` : "En attente du premier tour"}</small>
              {/* Average over the lap - circuit length / time - the only speed one loop can give. */}
              {bestRow && avgSpeedKmh(bestMs, chrono.race?.trackLengthM) != null
                ? <small className="bs-speed">{fmtSpeed(bestMs, chrono.race?.trackLengthM)}</small>
                : null}
              {/* The all-time record, and how far the session is from it: something to chase. */}
              <div className="bs-record">
                <span><Trophy /> RECORD DE LA PISTE</span>
                <b className={recordCmp.kind === "beaten" ? "is-old" : ""}>{fmtRecord(record.lapMs)}</b>
                <em>{record.driver ?? "À battre"}</em>
                <i>
                  {recordCmp.kind === "behind" ? `+${(recordCmp.gapMs / 1000).toFixed(3)} du record`
                    : recordCmp.kind === "beaten" ? `battu de ${(recordCmp.gainMs / 1000).toFixed(3)} !`
                    : "Qui va le battre ?"}
                </i>
              </div>
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
                CLASSEMENT OFFICIEL <i /> RÉSERVEZ VOTRE PROCHAINE SESSION <i /> RECORD DE LA PISTE {fmtRecord(record.lapMs)} · À BATTRE <i /> GOOD GAME À TOUS LES PILOTES <i /> MEGAKART FÈS <i />
              </span>
            ))}
          </div>
        </footer>
      </div>

      {/* Kept on screen through the green hold: the race starts the instant the bar turns green,
          so keying this to the phase alone would unmount the gantry on the very frame the
          pilots are meant to see it. */}
      {(phase === "countdown" || lightsGreen) && (
        <div className="bs-countdown" role="status" aria-live="assertive">
          <span className="bs-kicker">
            {source === "sim"
              ? `GRILLE DE DÉPART · ${SIM_LAPS} TOURS`
              : chrono.race?.raceName
                ? `GRILLE DE DÉPART · ${chrono.race.raceName.toUpperCase()}`
                : "GRILLE DE DÉPART"}
          </span>
          <div className="bs-lights">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className={"bs-light" + (lights >= n ? " is-on" : "") + (lightsGreen ? " is-green" : "")}><i /><i /></div>
            ))}
          </div>
          <strong>{lightsGreen ? "FEUX VERTS · PARTEZ !" : "PRÉPAREZ-VOUS"}</strong>
        </div>
      )}
      {/* While the gantry is green the GO sits below it: the lamps are the signal a pilot reads
          from the far end of the track, and a full-screen word on top of them hides it. */}
      {showGo && <div className={"bs-go" + (lightsGreen ? " bs-go--under" : "")} aria-hidden="true">GO!</div>}

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
        <IntroTraffic active={phase === "intro"} />
        <div className="bs-intro-title"><span>MEGAKART FÈS</span><b>CHRONO EN DIRECT</b></div>
        <div className="bs-intro-bar"><i /></div>
      </div>

      <nav className="bs-controls" aria-label="Commandes de l’écran">
        {/* The real start: lights for the pilots, and the chrono released on green. Disabled
            unless Timing Control actually has a race prepared, so it cannot fire into nothing. */}
        <button
          type="button"
          className="bs-btn bs-btn--go"
          onClick={() => void startRace()}
          disabled={starting || phase === "countdown" || chrono.race?.state !== "PREPARED"}
          title={chrono.race?.state === "PREPARED" ? "Lancer le départ" : "Préparez la course depuis le dashboard"}
        >
          <TrafficCone /> Départ <kbd>D</kbd>
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

      {startError && (
        <p className="bs-start-error" role="alert" onClick={() => setStartError(null)}>{startError}</p>
      )}
    </div>
  );
}
