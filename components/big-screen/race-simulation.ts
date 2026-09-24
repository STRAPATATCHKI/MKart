// Self-contained race simulator for the big-screen leaderboard. Pure data in / data out so
// the screen can drive it from a timer and it can be reasoned about without the DOM.

export type BoardRow = {
  id: string;
  rank: number;
  name: string;
  kart: string;
  laps: number;
  last: string;
  best: string;
  bestMs: number | null;
  gap: string;
  total: string;
  finished: boolean;
  lapProgress: number; // 0..1 through the current lap
  pilot?: number | null; // pilot picked at sign-up (1-8)
  /** Set the fastest single lap of the race - shown even when the driver finished lower. */
  fastest?: boolean;
};

export type RaceEvent =
  | { kind: "overtake"; driver: string; passed: string; rank: number }
  | { kind: "best"; driver: string; time: string }
  | { kind: "lastlap"; driver: string }
  | { kind: "flag"; driver: string };

type SimDriver = {
  id: string;
  name: string;
  kart: string;
  pace: number;
  consistency: number;
  lapsDone: number;
  lapTarget: number;
  lapElapsed: number;
  last: number | null;
  best: number | null;
  finishedAt: number | null;
};

export type SimState = {
  laps: number;
  clock: number; // simulated race time, ms
  drivers: SimDriver[];
  order: string[]; // ids, P1 first
  overallBest: number | null;
  lastLapAnnounced: boolean;
  flagOut: boolean;
  done: boolean;
};

const ROSTER: Array<[string, string]> = [
  ["Youssef Amrani", "07"], ["Salma El Idrissi", "12"], ["Mehdi Rahali", "03"], ["Inès Lahlou", "21"],
  ["Nabil Ouazzani", "09"], ["Rania Kettani", "15"], ["Adam Mansouri", "04"], ["Hamza Zniber", "18"],
];

export const fmtLap = (ms: number | null) => {
  if (ms == null) return "—";
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}` : s.toFixed(3);
};

export const fmtClock = (ms: number) => {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  return `${String(m).padStart(2, "0")}:${(total - m * 60).toFixed(1).padStart(4, "0")}`;
};

const gauss = () => {
  const u = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};

function sampleLap(d: SimDriver) {
  const warmup = Math.max(0, 3 - d.lapsDone) * 180; // cold tyres on the first laps
  const mistake = Math.random() < 0.07 ? 900 + Math.random() * 1800 : 0;
  return Math.round(d.pace + warmup + gauss() * d.consistency + mistake);
}

export function createSimulation(laps = 8): SimState {
  const drivers: SimDriver[] = ROSTER.map(([name, kart], i) => ({
    id: kart,
    name,
    kart,
    pace: 41_600 + i * 230 + Math.random() * 500,
    consistency: 260 + Math.random() * 380,
    lapsDone: 0,
    lapTarget: 0,
    lapElapsed: 0,
    last: null,
    best: null,
    finishedAt: null,
  }));
  // Reverse-ish grid: quicker drivers start further back so the field has to fight through.
  drivers.sort((a, b) => b.pace + (Math.random() - 0.5) * 900 - (a.pace + (Math.random() - 0.5) * 900));
  drivers.forEach((d, grid) => {
    d.lapTarget = sampleLap(d);
    d.lapElapsed = -grid * 380;
  });
  return { laps, clock: 0, drivers, order: drivers.map((d) => d.id), overallBest: null, lastLapAnnounced: false, flagOut: false, done: false };
}

const progressOf = (d: SimDriver) => d.lapsDone + d.lapElapsed / d.lapTarget;

function rank(drivers: SimDriver[]) {
  // A finished driver counts as exactly their completed laps, so a lapped kart taking the flag
  // never jumps ahead of someone still on a lead-lap.
  const distance = (d: SimDriver) => (d.finishedAt != null ? d.lapsDone : progressOf(d));
  return [...drivers].sort((a, b) => {
    if (a.finishedAt != null && b.finishedAt != null && a.lapsDone === b.lapsDone) return a.finishedAt - b.finishedAt;
    return distance(b) - distance(a);
  });
}

// Advances the race by `simMs` of simulated time. Mutates and returns the state plus any
// events worth announcing on screen.
export function stepSimulation(state: SimState, simMs: number): { state: SimState; events: RaceEvent[] } {
  const events: RaceEvent[] = [];
  if (state.done) return { state, events };
  state.clock += simMs;

  for (const d of state.drivers) {
    if (d.finishedAt != null) continue;
    d.lapElapsed += simMs;
    while (d.lapElapsed >= d.lapTarget && d.finishedAt == null) {
      const overflow = d.lapElapsed - d.lapTarget;
      d.lapsDone += 1;
      d.last = d.lapTarget;
      d.best = d.best == null ? d.lapTarget : Math.min(d.best, d.lapTarget);
      if (state.overallBest == null || d.lapTarget < state.overallBest) {
        if (state.overallBest != null) events.push({ kind: "best", driver: d.name, time: fmtLap(d.lapTarget) });
        state.overallBest = d.lapTarget;
      }
      if (d.lapsDone >= state.laps || state.flagOut) {
        d.finishedAt = state.clock - overflow;
        d.lapElapsed = d.lapTarget;
        if (!state.flagOut) {
          state.flagOut = true;
          events.push({ kind: "flag", driver: d.name });
        }
      } else {
        d.lapTarget = sampleLap(d);
        d.lapElapsed = overflow;
        if (d.lapsDone === state.laps - 1 && !state.lastLapAnnounced) {
          state.lastLapAnnounced = true;
          events.push({ kind: "lastlap", driver: d.name });
        }
      }
    }
  }

  const ranked = rank(state.drivers);
  ranked.forEach((d, i) => {
    const before = state.order.indexOf(d.id);
    // Only call out overtakes once the field is rolling, not the grid shuffle at the start.
    if (before > i && d.lapsDone >= 1 && d.finishedAt == null) {
      const passed = state.drivers.find((x) => x.id === state.order[i]);
      if (passed) events.push({ kind: "overtake", driver: d.name, passed: passed.name, rank: i + 1 });
    }
  });
  state.order = ranked.map((d) => d.id);
  state.done = state.drivers.every((d) => d.finishedAt != null);
  return { state, events };
}

/** Final classification of a finished simulation, in the shape a race souvenir needs. */
export function simulationResults(state: SimState) {
  return state.order.map((id) => {
    const d = state.drivers.find((x) => x.id === id)!;
    return {
      name: d.name,
      kart: d.kart,
      laps: d.lapsDone,
      bestLapMs: d.best,
      totalTimeMs: d.finishedAt == null ? null : Math.round(d.finishedAt),
      pilot: (state.drivers.indexOf(d) % 8) + 1, // the demo field gets one pilot each
    };
  });
}

export function simulationRows(state: SimState): BoardRow[] {
  const ranked = state.order.map((id) => state.drivers.find((d) => d.id === id)!);
  const leader = ranked[0];
  return ranked.map((d, i) => {
    let gap = "LEADER";
    if (i > 0) {
      if (d.finishedAt != null && leader.finishedAt != null && d.lapsDone < leader.lapsDone) gap = `+${leader.lapsDone - d.lapsDone} T`;
      else if (d.finishedAt != null && leader.finishedAt != null) gap = `+${((d.finishedAt - leader.finishedAt) / 1000).toFixed(3)}`;
      else {
        const behind = progressOf(leader) - progressOf(d);
        gap = behind >= 1 ? `+${Math.floor(behind)} T` : `+${((behind * d.pace) / 1000).toFixed(3)}`;
      }
    }
    return {
      id: d.id,
      rank: i + 1,
      name: d.name,
      kart: d.kart,
      laps: d.lapsDone,
      last: fmtLap(d.last),
      best: fmtLap(d.best),
      bestMs: d.best,
      gap,
      total: d.finishedAt != null ? fmtLap(d.finishedAt) : "—",
      finished: d.finishedAt != null,
      lapProgress: d.finishedAt != null ? 1 : Math.min(1, Math.max(0, d.lapElapsed / d.lapTarget)),
      pilot: (state.drivers.indexOf(d) % 8) + 1,
    };
  });
}
