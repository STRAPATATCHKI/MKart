"use client";

// The races MegaKart Timing Control has already saved, for the dashboard.
//
// This is not polled. A finished race is a file on disk that never changes again, and the only
// event that adds one is the operator ending a race — which the current race's id and state
// report a moment later. Polling a list of results once a second would be a request per second
// for a list that changes five times an evening.
//
// The laps are fetched one race at a time, when a race is opened: the list endpoint carries no
// laps, and an evening of racing is a few hundred laps that nobody asked to see.

import { useCallback, useEffect, useRef, useState } from "react";
import { raceSummaries, type RaceSummary } from "@/components/timing/race-summaries";
import { timing, TimingOffline, type TimingRaceState, type TimingSavedRace } from "@/lib/timing-client";

export type RaceDetail =
  | { status: "loading" }
  | { status: "ready"; race: TimingSavedRace }
  | { status: "error"; message: string };

export type RaceHistoryView = {
  races: RaceSummary[];
  /** Whether Timing Control answered. False means the chrono PC is shut, not that there are none. */
  online: boolean;
  /** False until the first answer, so an empty list is never mistaken for "no races". */
  loaded: boolean;
  details: Record<string, RaceDetail>;
  /** Fetch a race's laps if they are not already in hand. */
  open: (raceId: string) => void;
  refresh: () => void;
};

export function useRaceHistory(currentRaceId: string | null, currentState: TimingRaceState | null): RaceHistoryView {
  const [races, setRaces] = useState<RaceSummary[]>([]);
  const [online, setOnline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [details, setDetails] = useState<Record<string, RaceDetail>>({});
  const asked = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      setRaces(raceSummaries(await timing.races()));
      setOnline(true);
    } catch (e) {
      if (e instanceof TimingOffline) setOnline(false);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Both the id and the state are watched because builds differ on when the race is written:
  // some save at FINISH, some only at « Session suivante », when the id drops back to null.
  // Watching both means the race the operator just ran is in the list either way, without a
  // reload of the page.
  //
  // The fetch is scheduled for the next tick rather than run in the effect body, which is what
  // the react-hooks rule guards against, and which also collapses the burst of changes the end
  // of a race produces into a single look at the list.
  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(t);
  }, [refresh, currentRaceId, currentState]);

  // A shut chrono is the one case the list cannot heal from on its own: no race id will ever
  // change while Timing Control is down, so nothing would ever ask again. This covers the
  // ordinary evening where the dashboard is opened before the chrono is.
  useEffect(() => {
    if (online || !loaded) return;
    const id = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(id);
  }, [online, loaded, refresh]);

  const open = useCallback((raceId: string) => {
    if (asked.current.has(raceId)) return;
    asked.current.add(raceId);
    setDetails((d) => ({ ...d, [raceId]: { status: "loading" } }));
    void (async () => {
      try {
        const race = await timing.race(raceId);
        setDetails((d) => ({ ...d, [raceId]: { status: "ready", race } }));
      } catch (e) {
        // Forgetting the failed race lets the operator retry simply by opening the row again,
        // which is what they will do when the chrono comes back up.
        asked.current.delete(raceId);
        const message = e instanceof TimingOffline
          ? "MegaKart Timing Control ne répond pas."
          : e instanceof Error ? e.message : String(e);
        setDetails((d) => ({ ...d, [raceId]: { status: "error", message } }));
      }
    })();
  }, []);

  return { races, online, loaded, details, open, refresh: () => void refresh() };
}
