"use client";

// Reads the GoKarts session plan from the bridge (GoServer's own sessions.json export).
// Unauthenticated. Gives session list + type/duration/state/driver-COUNT (not names).
import { useEffect, useState } from "react";

const BRIDGE_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_APEX_BRIDGE_URL) ||
  "http://localhost:8787";

export type GokartsSession = {
  index: number;
  num: number;
  title: string;
  type: string;
  duration: number; // seconds
  laps: number;
  state: string; // "" | "finished" | ...
  drivers: number; // COUNT
};
export type GokartsPlan = { date: number | null; track: string | null; sessions: GokartsSession[]; loaded: boolean };

export function useGokartsSessions(pollMs = 4000): GokartsPlan {
  const [plan, setPlan] = useState<GokartsPlan>({ date: null, track: null, sessions: [], loaded: false });
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const r = await fetch(`${BRIDGE_URL}/sessions`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        if (!stopped) setPlan({ date: d.date ?? null, track: d.track ?? null, sessions: Array.isArray(d.sessions) ? d.sessions : [], loaded: true });
      } catch {
        if (!stopped) setPlan((p) => ({ ...p, loaded: true }));
      }
    };
    tick();
    const t = setInterval(tick, pollMs);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [pollMs]);
  return plan;
}
