// The dashboard's door into MegaKart Timing Control (C:\MegaK\ApexDiagnostic): the standalone
// ActiveBox timing service that replaced Apex/GoKarts for race lifecycle.
//
// One permanent localhost port for every race of the day. Race 1, 2, 3 are told apart by the
// raceId in the payload, never by the port. The desktop buttons and these calls hit the SAME
// controller behind one lock, so nothing here can double-start a race.
//
// Nothing here touches COM3 or the decoder: PREPARE / START / FINISH / NEXT are software state.

export const TIMING_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_TIMING_URL) ||
  "http://127.0.0.1:8795";

export type TimingRaceState = "IDLE" | "PREPARED" | "RUNNING" | "FINISHED" | "RESETTING_FOR_NEXT";

export type TimingDriver = {
  driver: string;
  kart: number;
  transponder: string;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  position: number | null;
  // Every scored lap in order, index 0 being lap 1, and which of them is the driver's best.
  // Optional because a Timing Control older than the lap-detail build sends neither, and the
  // panel then falls back to the last/best pair it has always shown.
  lapTimesMs?: number[];
  bestLapIndex?: number | null;
  grid?: number | null;   // starting slot, 1 = pole
  color?: number | null;  // pilot colour 1-8, made distinct within the race by the chrono
  lastPassingAt?: number | null;  // epoch ms of the kart's last crossing of the line
};

export type TimingRace = {
  raceId: string | null;
  raceName: string | null;
  state: TimingRaceState;
  durationS: number | null;
  durationMs?: number | null;
  remainingMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  drivers: TimingDriver[];
  absenceSeconds?: number;
  absenceCalibrated?: boolean;
  clockStarted?: boolean;
  startMode?: "first_crossing" | "immediate";
  /** "course": most laps wins. "chronos": fastest lap wins, laps do not matter. */
  rankMode?: "course" | "chronos";
  /** Circuit length in metres, from Timing Control's config; speeds are length / lap time. */
  trackLengthM?: number | null;
};

export type TimingKart = { kart: number; transponder: string; enabled: boolean; color: number | null };

// ---- races Timing Control has already saved (data\results.sqlite + data\races\*.json) --------
//
// These timestamps are seconds since the epoch, not the ISO strings the live race frame uses:
// they come back out of the saved file exactly as Python wrote them. Anything reading them has
// to multiply by 1000 before handing them to Date.

/** One line of GET /api/races: enough for a list, with no lap detail in it. */
export type TimingSavedRaceSummary = {
  raceId: string;
  name: string | null;
  state: TimingRaceState;
  startedAt: number | null;
  finishedAt: number | null;
  /** The duration the race was booked for, in seconds — not the time it actually took. */
  durationS: number | null;
  savedAt: number | null;
  racers: number;
};

export type TimingSavedRacer = {
  driver: string;
  kart: number;
  transponder: string;
  position: number | null;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  /** Absent on races saved before the lap-detail build; the panel then shows the line alone. */
  lapTimesMs?: number[];
  /** seq 0 is the reference crossing and carries no lapMs; crossings[n].lapMs is lap n. */
  crossings?: { seq: number; decoderTicks: number; lapMs: number | null }[];
  ignoredReads?: number;
};

/** GET /api/races/<id>: the same race with its drivers, their laps and the kart map of the day. */
export type TimingSavedRace = Omit<TimingSavedRaceSummary, "racers"> & {
  kartMapping?: Record<string, { kartNumber: number; enabled: boolean; color: number | null }>;
  racers: TimingSavedRacer[];
};

export type TimingHealth = {
  status: "ok";
  activeBox: boolean;
  comConnected: boolean;
  raceState: TimingRaceState;
  version: string;
};

export type TimingCommandResult =
  | { success: true; state: TimingRaceState; raceId: string | null; race: TimingRace }
  | { success: false; error: string; message: string; state?: TimingRaceState; raceId?: string | null };

export class TimingOffline extends Error {
  constructor() {
    super("MegaKart Timing Control ne répond pas");
  }
}

async function call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${TIMING_URL}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new TimingOffline();
  }
  // Race commands answer with success/error in the body even on 4xx, so parse before judging.
  const json = (await res.json().catch(() => null)) as T | null;
  if (json === null) throw new Error(`Timing Control: réponse illisible (${res.status})`);
  return json;
}

export const timing = {
  health: () => call<TimingHealth>("GET", "/health"),
  status: () => call<{ success: true } & Record<string, unknown>>("GET", "/api/status"),
  current: async () => (await call<{ success: true; race: TimingRace }>("GET", "/api/race/current")).race,
  karts: async () => (await call<{ success: true; karts: TimingKart[] }>("GET", "/api/karts")).karts,
  setKart: (kart: number, transponder: string | null, color?: number | null, enabled = true) =>
    call<{ success: true; karts: TimingKart[] }>("PUT", `/api/karts/${kart}`, { transponder, color, enabled }),

  /** Drivers + kart numbers; the transponder is resolved from Timing Control's own kart map. */
  prepare: (name: string, durationMs: number, drivers: { name: string; kart: number; grid?: number }[], raceId?: string, rankMode: "course" | "chronos" = "course") =>
    call<TimingCommandResult>("POST", "/api/race/prepare", { name, durationMs, drivers, raceId, rankMode }),
  start: () => call<TimingCommandResult>("POST", "/api/race/start"),
  finish: () => call<TimingCommandResult>("POST", "/api/race/finish"),
  reset: () => call<TimingCommandResult>("POST", "/api/race/reset"),
  next: () => call<TimingCommandResult>("POST", "/api/race/next"),
  /** Move a driver into another kart mid-race; their laps travel with them. */
  changeKart: (transponder: string, kart: number) =>
    call<TimingCommandResult>("POST", "/api/race/kart", { transponder, kart }),

  races: async () => (await call<{ success: true; races: TimingSavedRaceSummary[] }>("GET", "/api/races")).races,

  /** One saved race with its laps. Answers 404 with a body, so the refusal is read, not guessed. */
  race: async (raceId: string) => {
    const res = await call<
      { success: true; race: TimingSavedRace } | { success: false; error: string; message: string }
    >("GET", `/api/races/${encodeURIComponent(raceId)}`);
    if (!res.success) throw new Error(explainTimingError(res.error, res.message));
    return res.race;
  },
};

/** French, operator-facing, for the messages a rejected command produces. */
export function explainTimingError(code: string, message: string): string {
  switch (code) {
    case "RACE_RUNNING": return "Une course est en cours côté chrono : terminez-la d’abord (FINISH).";
    case "ALREADY_RUNNING": return "La course est déjà lancée.";
    case "NOT_PREPARED": return "Préparez d’abord la course (envoyez les pilotes au chrono).";
    case "NOT_RUNNING": return "Aucune course en cours.";
    case "UNMAPPED_KART": return `Kart sans transpondeur dans Timing Control : ${message}`;
    case "NO_DRIVERS": return "Aucun pilote à envoyer.";
    case "KART_TAKEN": return `Ce kart est déjà pris dans cette course : ${message}`;
    case "UNKNOWN_DRIVER": return "Pilote introuvable dans la course en cours.";
    // Deliberately NOT handled here: the chrono answers NOT_FOUND for an unknown ROUTE as well
    // as for an unknown race, so translating it as "course introuvable" would tell an operator
    // on an older Timing Control that their race is missing when the endpoint is.

    default: return `${code} : ${message}`;
  }
}
