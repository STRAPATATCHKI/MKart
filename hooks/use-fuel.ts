"use client";

// React state around the fuel store (localStorage, this PC).
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getFuelServerSnapshot,
  getFuelSnapshot,
  setFuelState,
  sortDays,
  subscribeFuel,
  todayKey,
  upsertDay,
  type FuelDay,
  type FuelSettings,
} from "@/lib/fuel-store";

/**
 * A copy on the desk (PUT /api/fuel), so the bridge can send the day's fuel to the manager's
 * app. Best effort: this browser stays the page's own store, and an old or unreachable desk
 * only means the app is a little behind.
 */
function copyToDesk() {
  const { settings, days } = getFuelSnapshot();
  void fetch("/api/fuel", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings, days: sortDays(days).slice(0, 120) }),
  }).catch(() => {});
}

export function useFuel() {
  const state = useSyncExternalStore(subscribeFuel, getFuelSnapshot, getFuelServerSnapshot);

  // Once when the page opens, so the desk has the readings even before the next change.
  useEffect(() => {
    const t = window.setTimeout(copyToDesk, 1500);
    return () => window.clearTimeout(t);
  }, []);

  const saveDay = useCallback((day: Omit<FuelDay, "updatedAt">) => {
    setFuelState(upsertDay(getFuelSnapshot(), day));
    copyToDesk();
  }, []);

  const saveSettings = useCallback((patch: Partial<FuelSettings>) => {
    const current = getFuelSnapshot();
    setFuelState({ ...current, settings: { ...current.settings, ...patch } });
    copyToDesk();
  }, []);

  const days = sortDays(state.days);
  const today = days.find((d) => d.date === todayKey()) ?? null;

  return { settings: state.settings, days, today, saveDay, saveSettings };
}
