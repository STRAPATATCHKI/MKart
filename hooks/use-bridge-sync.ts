"use client";

// Keeps the local Apex bridge in step with the dashboard:
//  • pushes the active MegaKart session, so the live board and the archived results use its
//    drivers' names and kart numbers (matched by transponder);
//  • links every archived result back to its session (state FINISHED + resultId) and then
//    deactivates it, so the next race never inherits the previous roster.
import { useEffect, useState } from "react";
import { activeSessionPayload, BRIDGE_URL, BridgeError, pushActiveSession } from "@/lib/bridge-client";
import { getActiveSessionId, getSession, setActiveSessionId, updateSession } from "@/lib/megakart-session";
import type { HistorySession } from "./use-history";

export type BridgeSync = {
  status: "idle" | "synced" | "offline" | "refused" | "outdated";
  sessionName: string | null; // active session the bridge is naming drivers from
  message: string | null;
};

const CHANGED = "mk-sessions-changed";
const HEARTBEAT_MS = 30_000;
const POLL_MS = 5_000;

export function useBridgeSessionSync(enabled = true): BridgeSync {
  const [sync, setSync] = useState<BridgeSync>({ status: "idle", sessionName: null, message: null });

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let lastPushed = "";
    let lastPushedAt = 0;
    let pushing = false;

    const pushActive = async (force = false) => {
      if (pushing) return;
      const activeId = getActiveSessionId();
      const session = activeId ? getSession(activeId) : undefined;
      const payload = activeSessionPayload(session);
      const json = JSON.stringify(payload);
      if (!force && json === lastPushed && Date.now() - lastPushedAt < HEARTBEAT_MS) return;
      pushing = true;
      try {
        await pushActiveSession(payload);
        lastPushed = json;
        lastPushedAt = Date.now();
        if (!stopped) setSync({ status: "synced", sessionName: session?.name ?? null, message: null });
      } catch (error) {
        lastPushed = "";
        const kind = error instanceof BridgeError ? error.kind : "offline";
        const message = error instanceof Error ? error.message : null;
        if (!stopped) setSync({ status: kind, sessionName: session?.name ?? null, message });
      } finally {
        pushing = false;
      }
    };

    const linkResults = async () => {
      let history: HistorySession[];
      try {
        const res = await fetch(`${BRIDGE_URL}/history`, { cache: "no-store" });
        if (!res.ok) return;
        history = (await res.json()) as HistorySession[];
      } catch {
        return;
      }
      if (stopped || !Array.isArray(history)) return;
      let changed = false;
      // Oldest first, so a session gets the first result archived while it was active.
      for (const entry of [...history].reverse()) {
        const sessionId = entry.megakart?.sessionId;
        if (!sessionId) continue;
        const session = getSession(sessionId);
        if (!session || session.resultId) continue;
        updateSession(sessionId, { state: "FINISHED", resultId: entry.id });
        if (getActiveSessionId() === sessionId) setActiveSessionId(null);
        changed = true;
      }
      if (changed) {
        window.dispatchEvent(new Event(CHANGED));
        void pushActive(true);
      }
    };

    const onChange = () => void pushActive();
    window.addEventListener(CHANGED, onChange);
    window.addEventListener("storage", onChange);
    void pushActive(true);
    void linkResults();
    const timer = window.setInterval(() => {
      void linkResults();
      void pushActive();
    }, POLL_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener(CHANGED, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [enabled]);

  return sync;
}
