"use client";

// React state around the fuel store (localStorage, this PC).
import { useCallback, useSyncExternalStore } from "react";
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

export function useFuel() {
  const state = useSyncExternalStore(subscribeFuel, getFuelSnapshot, getFuelServerSnapshot);

  const saveDay = useCallback((day: Omit<FuelDay, "updatedAt">) => {
    setFuelState(upsertDay(getFuelSnapshot(), day));
  }, []);

  const saveSettings = useCallback((patch: Partial<FuelSettings>) => {
    const current = getFuelSnapshot();
    setFuelState({ ...current, settings: { ...current.settings, ...patch } });
  }, []);

  const days = sortDays(state.days);
  const today = days.find((d) => d.date === todayKey()) ?? null;

  return { settings: state.settings, days, today, saveDay, saveSettings };
}
