"use client";

// Subscribes to the local Apex Live Bridge (read-only tap of the GoKarts feed) and
// exposes normalized live-race data for the dashboard. Falls back gracefully when the
// bridge is unreachable or no session is running.
//
// Bridge URL: import.meta.env.VITE_APEX_BRIDGE_URL or http://localhost:8787
import { useEffect, useRef, useState } from "react";

export type RaceStatus = "idle" | "waiting" | "running" | "finished" | "offline";

export type LiveDriver = {
  rank: number;
  name: string;
  kart: string;
  transponder: string;
  best: string; // "42.184"
  last: string;
  gap: string;
  color: string;
  pilot: number | null; // pilot chosen at sign-up (1-8), when the driver came from a session
  laps: number;
  sector: string;
};

export type LiveRace = {
  bridgeConnected: boolean; // bridge process reachable
  feedConnected: boolean; // bridge is connected to the GoKarts feed
  sessionActive: boolean; // a session is running on track
  status: RaceStatus; // idle | waiting | running | finished | offline
  drivers: LiveDriver[]; // normalized rows (empty when idle)
  updatedAt: string | null;
  lastArchive: { id: string; archivedAt: string; megakartSessionId: string | null } | null; // latest results saved to history
  megakartSession: { id: string; name: string; type: string; drivers: number } | null; // session the bridge names drivers from
};

const BRIDGE_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_APEX_BRIDGE_URL) ||
  "http://localhost:8787";

const COLORS = ["#d8ff35", "#f4f6ed"];

function fmtLap(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return m > 0 ? `${m}:${rest.toFixed(3).padStart(6, "0")}` : rest.toFixed(3);
}

type BridgeDriver = {
  position: number | null;
  kart: string | null;
  transponder: string | null;
  name: string | null;
  laps: number | null;
  lastLapMs: number | null;
  bestLapMs: number | null;
  gap: string | null;
  color?: number | null;
};

function normalize(payload: {
  connected?: boolean;
  status?: RaceStatus;
  session?: { active?: boolean };
  drivers?: BridgeDriver[];
  updatedAt?: string | null;
  lastArchive?: LiveRace["lastArchive"];
  activeSession?: LiveRace["megakartSession"];
}): LiveRace {
  const drivers = (payload.drivers ?? []).map((d, i) => ({
    rank: d.position ?? i + 1,
    name: d.name ?? `Kart ${d.kart ?? "?"}`,
    kart: d.kart ?? "—",
    transponder: d.transponder ?? "—",
    best: fmtLap(d.bestLapMs),
    last: fmtLap(d.lastLapMs),
    gap: d.gap ?? (i === 0 ? "LEADER" : "—"),
    color: COLORS[i % COLORS.length],
    pilot: d.color ?? null,
    laps: d.laps ?? 0,
    sector: "—",
  }));
  const status = payload.status ?? (payload.connected ? "waiting" : "idle");
  return {
    bridgeConnected: true,
    feedConnected: !!payload.connected,
    sessionActive: status === "running",
    status,
    drivers,
    updatedAt: payload.updatedAt ?? null,
    lastArchive: payload.lastArchive ?? null,
    megakartSession: payload.activeSession ?? null,
  };
}

const DISCONNECTED: LiveRace = {
  bridgeConnected: false,
  feedConnected: false,
  sessionActive: false,
  status: "offline",
  drivers: [],
  updatedAt: null,
  lastArchive: null,
  megakartSession: null,
};

export type LiveRoster = Record<string, { name?: string; kart?: string }>;

// Overlay a MegaKart session roster (transponder → name/kart) onto the raw feed drivers,
// so live names/karts resolve from the operator's session instead of a static map.
function applyRoster(race: LiveRace, roster?: LiveRoster): LiveRace {
  if (!roster || race.drivers.length === 0) return race;
  return {
    ...race,
    drivers: race.drivers.map((d) => {
      const o = roster[d.transponder];
      return o ? { ...d, name: o.name ?? d.name, kart: o.kart ?? d.kart } : d;
    }),
  };
}

export function useLiveRace(rosterOverride?: LiveRoster): LiveRace {
  const [race, setRace] = useState<LiveRace>(DISCONNECTED);
  const rosterRef = useRef<LiveRoster | undefined>(rosterOverride);
  useEffect(() => {
    rosterRef.current = rosterOverride;
  }, [rosterOverride]);

  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const push = (payload: unknown) => {
      if (!stopped) setRace(applyRoster(normalize(payload as Parameters<typeof normalize>[0]), rosterRef.current));
    };

    // Prefer SSE; fall back to polling if EventSource errors out.
    const startPolling = () => {
      if (pollTimer) return;
      const tick = async () => {
        try {
          const r = await fetch(`${BRIDGE_URL}/live`, { cache: "no-store" });
          if (!r.ok) throw new Error(String(r.status));
          push(await r.json());
        } catch {
          if (!stopped) setRace(DISCONNECTED);
        }
      };
      tick();
      pollTimer = setInterval(tick, 1000);
    };

    try {
      es = new EventSource(`${BRIDGE_URL}/stream`);
      es.onmessage = (ev) => {
        try {
          push(JSON.parse(ev.data));
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        setRace(DISCONNECTED);
        startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      stopped = true;
      es?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  return race;
}
