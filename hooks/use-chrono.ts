"use client";

// The MegaKart chrono, as the dashboard sees it.
//
// The authoritative window lives in the bridge, not here: that way a refreshed tab, a sleeping
// laptop or a second dashboard cannot lose a race in progress. This hook only mirrors the
// bridge's state and sends start/stop commands.

import { useCallback, useEffect, useState } from "react";

const BRIDGE_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_APEX_BRIDGE_URL) ||
  "http://localhost:8787";

export type ChronoRow = {
  position: number;
  transponder: string;
  name: string | null;
  kart: number | null;
  color: number | null;
  crossings: number;
  /** raw crossings before the guard is applied; the difference is hidden, never lost */
  rawCrossings: number;
  excluded: number;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  totalTimeMs: number | null;
  gap: number | null;
  gapText: string | null;
};

export type ChronoIntegrity = {
  feedDrops: number;
  /** crossings the current guard is hiding from the board (still in the ledger) */
  excludedByGuard: number;
  ledgerSize: number;
  upstreamMarkersSeen: number;
  complete: boolean;
};

export type ChronoClassification = {
  rows: ChronoRow[];
  fastest: { transponder: string; name: string | null; bestLapMs: number } | null;
  totalCrossings: number;
  pilots: number;
  integrity: ChronoIntegrity;
};

export type ChronoState = {
  running: boolean;
  sessionId: string | null;
  name: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  minLapMs: number;
  elapsedMs: number;
  feedDrops: number;
  ledgerSize: number;
  upstreamMarkers: { flags: string; at: string }[];
  classification: ChronoClassification | null;
};

export type ChronoView = {
  chrono: ChronoState | null;
  /** bridge process reachable */
  bridgeConnected: boolean;
  /** bridge is attached to a GoKarts feed socket — without this, no crossing can ever arrive */
  feedConnected: boolean;
  busy: boolean;
  error: string | null;
  start: (opts?: { sessionId?: string | null; name?: string | null; minLapMs?: number }) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
  /** re-derive the board from the same crossings under a different guard */
  reclassify: (minLapMs: number) => Promise<void>;
};

const EMPTY: ChronoState = {
  running: false, sessionId: null, name: null, startedAt: null, stoppedAt: null,
  minLapMs: 250, elapsedMs: 0, feedDrops: 0, ledgerSize: 0,
  upstreamMarkers: [], classification: null,
};

export function fmtLap(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return m > 0 ? `${m}:${rest.toFixed(3).padStart(6, "0")}` : rest.toFixed(3);
}

export function fmtClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function useChrono(): ChronoView {
  const [chrono, setChrono] = useState<ChronoState | null>(null);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [feedConnected, setFeedConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local ticker so the elapsed clock advances smoothly between bridge pushes.
  const [, setTick] = useState(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const apply = (payload: { chrono?: ChronoState; connected?: boolean }) => {
      if (stopped) return;
      setBridgeConnected(true);
      setFeedConnected(!!payload.connected);
      setChrono(payload.chrono ?? EMPTY);
    };

    const startPolling = () => {
      if (poll) return;
      const tick = async () => {
        try {
          const r = await fetch(`${BRIDGE_URL}/live`, { cache: "no-store" });
          if (!r.ok) throw new Error(String(r.status));
          apply(await r.json());
        } catch {
          if (!stopped) { setBridgeConnected(false); setFeedConnected(false); }
        }
      };
      void tick();
      poll = setInterval(tick, 1000);
    };

    try {
      es = new EventSource(`${BRIDGE_URL}/stream`);
      es.onmessage = (e) => { try { apply(JSON.parse(e.data)); } catch { /* ignore a malformed frame */ } };
      es.onerror = () => { es?.close(); es = null; startPolling(); };
    } catch {
      startPolling();
    }

    return () => { stopped = true; es?.close(); if (poll) clearInterval(poll); };
  }, []);

  // Advance the on-screen clock once a second while counting.
  useEffect(() => {
    if (!chrono?.running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [chrono?.running]);

  const call = useCallback(async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${BRIDGE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (r.status === 403) throw new Error("Le chrono ne peut être piloté que depuis le PC du chronométrage.");
      if (!r.ok) throw new Error(`Le pont a répondu ${r.status}.`);
      const snap = await r.json();
      setChrono(snap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Le pont de chronométrage ne répond pas.");
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    chrono,
    bridgeConnected,
    feedConnected,
    busy,
    error,
    start: useCallback((opts) => call("/chrono/start", opts ?? {}), [call]),
    stop: useCallback(() => call("/chrono/stop"), [call]),
    reset: useCallback(() => call("/chrono/reset"), [call]),
    reclassify: useCallback((minLapMs) => call("/chrono/reclassify", { minLapMs }), [call]),
  };
}