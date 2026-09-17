// Fuel stock and consumption for the venue: the morning reading, refills during the day, and
// what the fleet burns. Kept as plain data + pure maths so the page only has to draw it.
//
// Persistence: localStorage (this PC), same as the session store.

export type FuelSettings = {
  capacityL: number; // barrel size, for the gauge
  juniorLph: number; // litres per hour, one JUNIOR kart running
  gtLph: number; // litres per hour, one GT kart running
  juniorKarts: number; // fleet on track
  gtKarts: number;
  sessionMinutes: number; // a standard session, for "how many sessions left"
  reserveL: number; // below this, reorder
};

export type FuelDay = {
  date: string; // YYYY-MM-DD
  openingL: number; // measured in the barrel this morning
  refillL: number; // added during the day
  note?: string;
  updatedAt: string;
};

export type FuelState = { settings: FuelSettings; days: FuelDay[] };

export const DEFAULT_FUEL_SETTINGS: FuelSettings = {
  capacityL: 500,
  juniorLph: 2.4,
  gtLph: 10,
  juniorKarts: 4,
  gtKarts: 8,
  sessionMinutes: 8,
  reserveL: 75,
};

const KEY = "megakart-fuel-v1";

// Values the first version shipped with. A stored setting still sitting on one of these was never
// touched by the operator, so it follows the new default; anything else they typed is left alone.
const SUPERSEDED_DEFAULTS: Partial<Record<keyof FuelSettings, number>> = {
  capacityL: 200,
  gtLph: 4.2,
  reserveL: 40,
};

function migrateSettings(stored: Partial<FuelSettings>): FuelSettings {
  const settings = { ...DEFAULT_FUEL_SETTINGS, ...stored };
  for (const [key, oldDefault] of Object.entries(SUPERSEDED_DEFAULTS) as Array<[keyof FuelSettings, number]>) {
    if (stored[key] === oldDefault) settings[key] = DEFAULT_FUEL_SETTINGS[key];
  }
  return settings;
}

export const todayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function readFuel(): FuelState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { settings: DEFAULT_FUEL_SETTINGS, days: [] };
    const parsed = JSON.parse(raw) as Partial<FuelState>;
    return {
      settings: migrateSettings(parsed.settings ?? {}),
      days: Array.isArray(parsed.days) ? parsed.days : [],
    };
  } catch {
    return { settings: DEFAULT_FUEL_SETTINGS, days: [] };
  }
}

export function writeFuel(state: FuelState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, days: state.days.slice(0, 120) }));
  } catch {
    /* storage unavailable — the page keeps working with what it has in memory */
  }
}

// Small external store, so React can read localStorage through useSyncExternalStore instead of
// copying it into state inside an effect. Other tabs stay in sync through the storage event.
export const EMPTY_FUEL: FuelState = { settings: DEFAULT_FUEL_SETTINGS, days: [] };
let cache: FuelState | null = null;
const listeners = new Set<() => void>();

export function getFuelSnapshot(): FuelState {
  if (!cache) cache = readFuel();
  return cache;
}

export function getFuelServerSnapshot(): FuelState {
  return EMPTY_FUEL;
}

export function subscribeFuel(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = () => {
    cache = readFuel();
    listeners.forEach((l) => l());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setFuelState(next: FuelState) {
  cache = next;
  writeFuel(next);
  listeners.forEach((listener) => listener());
}

/** Newest first, so the log reads like a diary. */
export function sortDays(days: FuelDay[]): FuelDay[] {
  return [...days].sort((a, b) => b.date.localeCompare(a.date));
}

export function upsertDay(state: FuelState, day: Omit<FuelDay, "updatedAt">): FuelState {
  const updated: FuelDay = { ...day, updatedAt: new Date().toISOString() };
  const days = state.days.some((d) => d.date === day.date)
    ? state.days.map((d) => (d.date === day.date ? updated : d))
    : [updated, ...state.days];
  return { ...state, days: sortDays(days) };
}

export type FuelEstimate = {
  stockL: number; // opening + refills
  level: number; // 0..1 of the barrel
  fleetLph: number; // every kart running at once
  juniorPerSessionL: number; // one JUNIOR kart, one session
  gtPerSessionL: number;
  fleetPerSessionL: number;
  hoursLeft: number;
  sessionsLeft: number;
  low: boolean; // at or under the reserve
};

export function estimateFuel(stockL: number, settings: FuelSettings): FuelEstimate {
  const hours = settings.sessionMinutes / 60;
  const fleetLph = settings.juniorKarts * settings.juniorLph + settings.gtKarts * settings.gtLph;
  const fleetPerSessionL = fleetLph * hours;
  return {
    stockL,
    level: settings.capacityL > 0 ? clamp(stockL / settings.capacityL, 0, 1) : 0,
    fleetLph,
    juniorPerSessionL: settings.juniorLph * hours,
    gtPerSessionL: settings.gtLph * hours,
    fleetPerSessionL,
    hoursLeft: fleetLph > 0 ? stockL / fleetLph : 0,
    sessionsLeft: fleetPerSessionL > 0 ? Math.floor(stockL / fleetPerSessionL) : 0,
    low: stockL <= settings.reserveL,
  };
}

/**
 * What a day actually burned, read from two readings: yesterday's opening plus what was poured
 * in, minus this morning's opening. Only meaningful for consecutive days that were both measured.
 */
export function usageBetween(previous: FuelDay | undefined, next: FuelDay | undefined): number | null {
  if (!previous || !next) return null;
  const used = previous.openingL + (previous.refillL || 0) - next.openingL;
  return used >= 0 ? used : null; // negative = the barrel was swapped, not consumption
}

/** Consumption per day for the log, newest first. */
export function dailyUsage(days: FuelDay[]): Array<{ day: FuelDay; usedL: number | null }> {
  const sorted = sortDays(days);
  return sorted.map((day, index) => ({ day, usedL: usageBetween(sorted[index + 1], day) }));
}

export const formatL = (litres: number, digits = 1) =>
  `${litres.toFixed(digits).replace(/\.0$/, "")} L`;

export const formatHours = (hours: number) => {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
};
