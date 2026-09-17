// MegaKart-side session model (SupportDev §7–8, Phase A).
// Sessions are created and owned by MegaKart FIRST; the actual Apex/GoKarts write is a
// separate step (see apex-session-controller.ts) that stays NOT_CONFIGURED until the
// authenticated Sessions API / import format is available. We store both ids and never
// use the session name alone as a mapping key.
//
// Persistence: localStorage for Phase A (per-operator, this PC). Production target is
// Cloudflare D1 via Drizzle — same shape, swap the store.

export type SessionType = "practice" | "race" | "game" | "merge";

// GoKarts UI label ↔ Apex JSON type (from apex-session-import-schema.md)
export const SESSION_TYPE_LABELS: { value: SessionType; label: string }[] = [
  { value: "practice", label: "Chronos" },
  { value: "race", label: "Course" },
  { value: "game", label: "Pay & Go" },
  { value: "merge", label: "Cumul / Meilleurs temps" },
];

// Lifecycle. Phase A can reach DRAFT → WAITING_APEX. The later states are driven by the
// Apex write path (Phase B) and by the live feed (RUNNING/FINISHED).
export type SessionState =
  | "DRAFT"
  | "WAITING_APEX"
  | "APEX_CREATED"
  | "READY"
  | "RUNNING"
  | "FINISHED";

export const STATE_LABELS: Record<SessionState, string> = {
  DRAFT: "Brouillon",
  WAITING_APEX: "En attente Apex",
  APEX_CREATED: "Créée dans Apex",
  READY: "Prête",
  RUNNING: "En course",
  FINISHED: "Terminée",
};

export interface SessionDriver {
  id: string; // MegaKart driver id (stable)
  name: string;
  kartNumber: number;
  transponder?: string; // links live feed passings → this driver
  color?: number; // pilot chosen at sign-up (1-8, images in public/drivers)
}

export interface MegaKartSession {
  id: string; // MegaKartRaceId (stable, never the name)
  name: string;
  type: SessionType;
  durationSec: number;
  drivers: SessionDriver[];
  state: SessionState;
  apexSessionId: string | null; // filled by Phase B when Apex creates the race
  resultId?: string | null; // bridge history entry (S-…) archived for this session when it finished
  createdAt: string;
  updatedAt: string;
}

const KEY = "megakart-sessions-v1";
const ACTIVE_KEY = "megakart-active-session-v1";

export function uid(prefix = "MK"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function read(): MegaKartSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write(list: MegaKartSession[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — ignore, in-memory callers still have the value */
  }
}

export function listSessions(): MegaKartSession[] {
  return read().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function getSession(id: string): MegaKartSession | undefined {
  return read().find((s) => s.id === id);
}

export interface NewSessionInput {
  name: string;
  type: SessionType;
  durationSec: number;
  drivers: { name: string; kartNumber: number; transponder?: string; color?: number }[];
}

export function createSession(input: NewSessionInput): MegaKartSession {
  const now = new Date().toISOString();
  const session: MegaKartSession = {
    id: uid(),
    name: input.name.trim() || "Session sans nom",
    type: input.type,
    durationSec: input.durationSec,
    drivers: input.drivers.map((d) => ({
      id: uid("DRV"),
      name: d.name.trim(),
      kartNumber: d.kartNumber,
      transponder: d.transponder?.trim() || undefined,
      color: d.color,
    })),
    state: "DRAFT",
    apexSessionId: null,
    createdAt: now,
    updatedAt: now,
  };
  write([session, ...read()]);
  return session;
}

export function updateSession(id: string, patch: Partial<MegaKartSession>): MegaKartSession | undefined {
  const list = read();
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return undefined;
  list[i] = { ...list[i], ...patch, id: list[i].id, updatedAt: new Date().toISOString() };
  write(list);
  return list[i];
}

export function deleteSession(id: string) {
  write(read().filter((s) => s.id !== id));
  if (getActiveSessionId() === id) setActiveSessionId(null);
}

export function getActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
export function setActiveSessionId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

// transponder → { name, kart } roster for the live-view overlay
export function rosterFor(session: MegaKartSession | undefined): Record<string, { name: string; kart: string }> {
  const map: Record<string, { name: string; kart: string }> = {};
  if (!session) return map;
  for (const d of session.drivers) {
    if (d.transponder) map[d.transponder] = { name: d.name, kart: String(d.kartNumber) };
  }
  return map;
}
