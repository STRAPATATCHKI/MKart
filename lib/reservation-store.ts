// Where reservations actually go.
//
// The visitor page must NEVER hand someone a booking code that the caisse cannot see. A code
// is a promise: the customer walks to the desk and reads it out. So the store is explicit
// about which mode it is in, and the UI is required to reflect it:
//
//   "desk"  — a real shared queue served by tools/reservations/desk.mjs. A code is issued.
//   "demo"  — this device only. NO code is issued, and the page says so.
//
// Mode is detected at runtime rather than fixed at build time: the same bundle is opened from
// the venue kiosk, from a dev machine, and from a phone, and guessing wrong in the optimistic
// direction is exactly the failure that hands out fake tickets.

import { createReservation as createLocal, type NewReservationInput, type Reservation } from "@/lib/reservation";

export type StoreMode = "desk" | "demo";

/**
 * Where the desk server lives. When the page is served BY the desk (the venue case) this is
 * the empty string, i.e. same-origin — which is the point: no CORS, no preflight, no
 * Access-Control-Allow-Private-Network, nothing to misconfigure.
 */
const DESK_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_RESERVATIONS_URL) ?? "";

const PROBE_TIMEOUT_MS = 2500;

let cachedMode: StoreMode | null = null;
let probeInFlight: Promise<StoreMode> | null = null;

/**
 * Ask the desk whether it is there. Cached for the page's lifetime: a visitor filling a form
 * should not re-probe on every keystroke, and the answer cannot meaningfully change mid-booking.
 */
export function detectMode(): Promise<StoreMode> {
  if (cachedMode) return Promise.resolve(cachedMode);
  if (probeInFlight) return probeInFlight;

  probeInFlight = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      const res = await fetch(`${DESK_URL}/api/reservations/sante`, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      cachedMode = res.ok ? "desk" : "demo";
    } catch {
      cachedMode = "demo";
    }
    return cachedMode;
  })();

  return probeInFlight;
}

export type SubmitResult =
  | { mode: "desk"; reservation: Reservation }
  /** No code: nothing was shared, so there is nothing to present at the desk. */
  | { mode: "demo"; reservation: Omit<Reservation, "code"> & { code: null } }
  | { mode: "desk"; error: "duplicate"; existingCode: string }
  | { mode: "desk"; error: "failed"; message: string };

/**
 * A key that survives a retry on a flaky 3G connection. Without it, the visitor's own
 * "Réessayer" tap is the thing most likely to create a second booking.
 */
function idempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function submitReservation(input: NewReservationInput): Promise<SubmitResult> {
  const mode = await detectMode();

  if (mode === "demo") {
    // Still record it locally so the page can show a recap — but with code: null, which is
    // what forces the UI down the honest path.
    const local = createLocal(input);
    return { mode: "demo", reservation: { ...local, code: null } };
  }

  try {
    const res = await fetch(`${DESK_URL}/api/reservations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey(),
      },
      body: JSON.stringify(input),
    });

    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      return { mode: "desk", error: "duplicate", existingCode: body.code ?? "" };
    }
    if (!res.ok) {
      return { mode: "desk", error: "failed", message: `Erreur ${res.status}` };
    }
    const reservation = (await res.json()) as Reservation;
    return { mode: "desk", reservation };
  } catch {
    return { mode: "desk", error: "failed", message: "La borne ne répond pas." };
  }
}
