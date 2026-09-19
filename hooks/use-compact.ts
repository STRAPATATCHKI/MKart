"use client";

// The operations dashboard is an office tool: it needs a real screen, a mouse and the venue
// network, so below a laptop width we don't render it at all. Client-facing pages (réservation,
// souvenir, inscription) are unaffected — they are built for phones. Read through an external
// store so there is no state-in-effect and no server/client mismatch.
import { useSyncExternalStore } from "react";

// Below this we treat the device as too small for the console: phones and small tablets.
const DESK_MIN_WIDTH = 1024;

const query = () =>
  typeof window !== "undefined" ? window.matchMedia(`(max-width: ${DESK_MIN_WIDTH - 1}px)`) : null;

function subscribe(onChange: () => void) {
  const mql = query();
  if (!mql) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

// Server render (Firebase static shell) can't know the width, so assume desktop and let the
// client correct on mount — the dashboard already waits for a client effect before painting.
export function useIsCompact() {
  return useSyncExternalStore(
    subscribe,
    () => (query()?.matches ?? false),
    () => false,
  );
}
