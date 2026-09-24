"use client";

// The kart ↔ transponder table as MegaKart Timing Control holds it.
//
// Timing Control owns the permanent map now (its KARTS tab writes data/karts.json); the bridge
// keeps an older copy of its own. The caisse needs the real fleet to put pilots in karts, so it
// asks the chrono rather than the bridge, and falls back to the bridge when the chrono is shut.
//
// Equipment changes a few times a year, so this polls slowly and never blocks the page.

import { useCallback, useEffect, useState } from "react";
import { timing, type TimingKart } from "@/lib/timing-client";

export type TimingKartsView = {
  /** kart number (as a string, the shape the caisse selects with) -> transponder */
  karts: Record<string, { transponder: string }>;
  online: boolean;
  refresh: () => void;
};

export function useTimingKarts(pollMs = 15_000): TimingKartsView {
  const [karts, setKarts] = useState<Record<string, { transponder: string }>>({});
  const [online, setOnline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows: TimingKart[] = await timing.karts();
      const map: Record<string, { transponder: string }> = {};
      for (const k of rows) {
        // A kart that has been taken out of service must not be offered to a pilot.
        if (k.enabled === false || !k.transponder) continue;
        map[String(k.kart)] = { transponder: k.transponder };
      }
      setKarts(map);
      setOnline(true);
    } catch {
      // Chrono closed: say so and keep whatever the caller already merged in.
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [refresh, pollMs]);

  return { karts, online, refresh: () => void refresh() };
}
