// Quick delete on the Liste d'attente: by code, or by pressing D five times on a row.
//
// Deleting sends a reservation to the "Supprimées" page (status SUPPRIMEE on the desk), where it
// can be restored or erased for good - so a fast gesture is safe. Pure logic, exercised by
// tests/queue-delete.test.mjs.

import type { Reservation } from "@/hooks/use-queue";

/** Presses needed, and how long between two presses before the count starts again. */
export const DELETE_PRESSES = 5;
export const PRESS_WINDOW_MS = 1500;

/** "MK-6149, 1165  azsm" -> ["MK-6149", "1165", "AZSM"]. */
export function codesFrom(input: string): string[] {
  return input.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
}

/**
 * The reservation a typed code means: the desk code (MK-6149, MK6149 or just 6149) or the code
 * the phone showed the client after the inscription (AZSM). Reservations already deleted are
 * never matched.
 */
export function findByCode(
  reservations: Reservation[],
  clientCodeOf: (queueCode: string) => string | null | undefined,
  token: string,
): Reservation | null {
  const t = token.toUpperCase().replace(/\s+/g, "");
  if (!t) return null;
  const desk = /^MK-?\d+$/.test(t) ? `MK-${t.replace(/^MK-?/, "")}` : /^\d{4}$/.test(t) ? `MK-${t}` : t;
  const live = reservations.filter((r) => r.status !== "SUPPRIMEE");
  return live.find((r) => r.code.toUpperCase() === desk)
    ?? live.find((r) => (clientCodeOf(r.code) ?? "").toUpperCase() === t)
    ?? null;
}

export type PressState = { code: string; count: number; at: number } | null;

/** One more D on `code`: counts up while the presses are quick and on the same row. */
export function nextPress(state: PressState, code: string, now: number): { code: string; count: number; at: number } {
  if (state && state.code === code && now - state.at <= PRESS_WINDOW_MS) return { code, count: state.count + 1, at: now };
  return { code, count: 1, at: now };
}
