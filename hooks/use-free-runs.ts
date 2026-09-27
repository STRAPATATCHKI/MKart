"use client";

// Karts that went round outside a race over the last days (Timing Control's activity log), for
// the fuel they burned. Read every minute; "unsupported" when the running Timing Control is older
// than the log and needs a restart, "offline" when it is closed.

import { useCallback, useEffect, useState } from "react";
import { timing, TimingOffline } from "@/lib/timing-client";
import { todayKey, type FreeStint } from "@/lib/fuel-store";

export type FreeRunsState = "loading" | "ready" | "unsupported" | "offline";

// A past day's free runs never change: read once per page load. Only today is read again.
const pastDays = new Map<string, FreeStint[]>();

export function useFreeRuns(daysBack = 7) {
  const [stints, setStints] = useState<FreeStint[]>([]);
  const [state, setState] = useState<FreeRunsState>("loading");

  const load = useCallback(async () => {
    const days = Array.from({ length: daysBack }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return todayKey(d);
    });
    try {
      const all: FreeStint[] = [];
      const today = days[0];
      for (const day of days) {
        const cached = day !== today ? pastDays.get(day) : undefined;
        if (cached) { all.push(...cached); continue; }
        const list = await timing.activity(day);
        if (list === null) { setState("unsupported"); setStints([]); return; }
        if (day !== today) pastDays.set(day, list);
        all.push(...list);
      }
      setStints(all);
      setState("ready");
    } catch (e) {
      setState(e instanceof TimingOffline ? "offline" : "ready");
    }
  }, [daysBack]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => void load(), 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [load]);

  return { stints, state };
}
