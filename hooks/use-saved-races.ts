"use client";

// Every race Timing Control has saved, with its laps - loaded once, then topped up.
//
// The list endpoint is cheap and carries no laps; each race's laps need their own request.
// Saved races never change, so each one is fetched once and kept for the life of the page; the
// list is re-read every minute and only the new ones are fetched. Shared by every page that
// wants results, so opening Clients twice does not download the season twice.

import { useEffect, useState } from "react";
import { timing, TimingOffline, type TimingSavedRace } from "@/lib/timing-client";

export type SavedRacesState = "loading" | "ready" | "offline";

const cache = new Map<string, TimingSavedRace>();
let state: SavedRacesState = "loading";
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

async function refresh(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const list = await timing.races();
      const missing = list.filter((r) => !cache.has(r.raceId));
      // A few at a time: this is the chrono's own HTTP server, and it is also timing a race.
      for (let i = 0; i < missing.length; i += 6) {
        const batch = await Promise.all(missing.slice(i, i + 6).map((r) => timing.race(r.raceId).catch(() => null)));
        for (const race of batch) if (race) cache.set(race.raceId, race);
        notify();
      }
      state = "ready";
    } catch (e) {
      state = e instanceof TimingOffline ? "offline" : (cache.size ? "ready" : "offline");
    } finally {
      inFlight = null;
      notify();
    }
  })();
  return inFlight;
}

export function useSavedRaces(pollMs = 60_000): { races: TimingSavedRace[]; state: SavedRacesState } {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => { listeners.delete(listener); window.clearTimeout(first); window.clearInterval(timer); };
  }, [pollMs]);
  return { races: [...cache.values()], state };
}
