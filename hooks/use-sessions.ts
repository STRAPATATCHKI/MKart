"use client";

// React state around the MegaKart session store (localStorage). SSR-safe: all reads happen
// in effects (no localStorage on the server). Components stay in sync via a window event.
import { useCallback, useEffect, useState } from "react";
import {
  createSession,
  deleteSession,
  getActiveSessionId,
  getSession,
  listSessions,
  rosterFor,
  setActiveSessionId,
  updateSession,
  type MegaKartSession,
  type NewSessionInput,
  type SessionState,
} from "@/lib/megakart-session";
import type { LiveRoster } from "./use-live-race";

const CHANGED = "mk-sessions-changed";
function announce() {
  try {
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    /* non-browser */
  }
}
function useChangeSubscription(reload: () => void) {
  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener(CHANGED, h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener(CHANGED, h);
      window.removeEventListener("storage", h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useSessions() {
  const [sessions, setSessions] = useState<MegaKartSession[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);

  const reload = useCallback(() => {
    setSessions(listSessions());
    setActiveIdState(getActiveSessionId());
  }, []);
  useChangeSubscription(reload);

  const create = useCallback((input: NewSessionInput) => {
    const s = createSession(input);
    // Phase A: session lives in MegaKart, awaiting the Apex write path.
    updateSession(s.id, { state: "WAITING_APEX" });
    setActiveSessionId(s.id);
    announce();
    return s;
  }, []);

  const remove = useCallback((id: string) => {
    deleteSession(id);
    announce();
  }, []);

  const setActive = useCallback((id: string | null) => {
    setActiveSessionId(id);
    announce();
  }, []);

  const setState = useCallback((id: string, state: SessionState) => {
    updateSession(id, { state });
    announce();
  }, []);

  return { sessions, activeId, create, remove, setActive, setState, reload };
}

// transponder → { name, kart } for the currently-active session, for the live-view overlay.
export function useActiveRoster(): LiveRoster {
  const [roster, setRoster] = useState<LiveRoster>({});
  useChangeSubscription(() => {
    const id = getActiveSessionId();
    setRoster(rosterFor(id ? getSession(id) : undefined));
  });
  return roster;
}
