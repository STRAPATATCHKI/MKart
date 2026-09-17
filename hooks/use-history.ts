"use client";

// Reads the bridge's session-history archive (finished sessions captured from the live feed).
import { useEffect, useState } from "react";

const BRIDGE_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_APEX_BRIDGE_URL) ||
  "http://localhost:8787";

export type HistoryDriver = {
  id: string;
  position: number | null;
  transponder: string;
  kart: string;
  name: string;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  totalTimeMs: number | null;
  gap: string | null;
  color?: number | null; // pilot chosen at sign-up (1-8)
};

export type HistorySession = {
  id: string;
  archivedAt: string;
  source: string;
  laps: number;
  bestLapMs: number | null;
  bestBy: string | null;
  winner: string | null;
  megakart?: { sessionId: string; name: string; type: string } | null; // dashboard session active when it was archived
  drivers: HistoryDriver[];
};

export function useHistory(pollMs = 5000): { sessions: HistorySession[]; loaded: boolean } {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const r = await fetch(`${BRIDGE_URL}/history`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as HistorySession[];
        if (!stopped) {
          setSessions(Array.isArray(data) ? data : []);
          setLoaded(true);
        }
      } catch {
        if (!stopped) setLoaded(true);
      }
    };
    tick();
    const t = setInterval(tick, pollMs);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [pollMs]);

  return { sessions, loaded };
}
