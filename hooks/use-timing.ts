"use client";

// Live view of MegaKart Timing Control from the dashboard: health, the current race, and the
// permanent kart map. Polls once a second - the timing service is on this machine, the calls
// are tiny, and polling survives a browser tab being reopened without any reconnect logic.
import { useCallback, useEffect, useRef, useState } from "react";
import { timing, TimingOffline, type TimingHealth, type TimingKart, type TimingRace } from "@/lib/timing-client";

export type TimingView = {
  online: boolean;
  health: TimingHealth | null;
  race: TimingRace | null;
  karts: TimingKart[];
  refresh: () => void;
};

export function useTiming(pollMs = 1000): TimingView {
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<TimingHealth | null>(null);
  const [race, setRace] = useState<TimingRace | null>(null);
  const [karts, setKarts] = useState<TimingKart[]>([]);
  const kartsAt = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [h, r] = await Promise.all([timing.health(), timing.current()]);
      setHealth(h);
      setRace(r);
      setOnline(true);
      // The kart map changes rarely; every 10 s is plenty.
      if (Date.now() - kartsAt.current > 10_000) {
        kartsAt.current = Date.now();
        setKarts(await timing.karts());
      }
    } catch (e) {
      if (e instanceof TimingOffline) {
        setOnline(false);
        setHealth(null);
      }
    }
  }, []);

  useEffect(() => {
    // First poll on the next tick rather than synchronously inside the effect, which is what
    // the react-hooks rule guards against; the interval then owns every later refresh.
    const first = window.setTimeout(() => void refresh(), 0);
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [refresh, pollMs]);

  return { online, health, race, karts, refresh: () => void refresh() };
}
