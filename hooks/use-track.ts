"use client";

// Reactive access to the shared MegaKart track layout. Re-reads when the operator saves an
// edit in the circuit editor (TRACK_CHANGED) or another tab changes it (storage event).
import { useEffect, useState } from "react";
import { defaultRoutePoints, hasLocalTrack, loadTrackRoute, readSharedTrack, saveSharedTrack, TRACK_CHANGED, type TrackRoute } from "@/lib/track";

// Once per page load at most: hand this browser's drawing to a desk that has none.
let handedOver = false;

export function useTrackRoute(): TrackRoute {
  const [route, setRoute] = useState<TrackRoute>({ points: defaultRoutePoints, start: 13, finish: 13 });
  useEffect(() => {
    // Paint immediately from this browser's copy, then let the desk's copy win: the local one
    // is only ever a cache, and a stale drawing on a wall screen is worse than a moment's flicker.
    let alive = true;
    const reload = () => {
      setRoute(loadTrackRoute());
      void readSharedTrack().then(({ reachable, route: shared }) => {
        if (!alive) return;
        if (shared) { setRoute(shared); return; }
        // The desk answered but has never been given a drawing, while this browser has one: the
        // circuit on this screen was drawn before the desk kept it. Hand it over, so the TV, the
        // other screens and the manager's app (via the bridge) draw this same circuit. The desk
        // accepts it only from this PC; anywhere else the request is refused and nothing changes.
        if (reachable && !handedOver && hasLocalTrack()) {
          handedOver = true;
          void saveSharedTrack(loadTrackRoute());
        }
      });
    };
    reload();
    window.addEventListener(TRACK_CHANGED, reload);
    window.addEventListener("storage", reload);
    return () => {
      alive = false;
      window.removeEventListener(TRACK_CHANGED, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  return route;
}
