"use client";

// Reactive access to the shared MegaKart track layout. Re-reads when the operator saves an
// edit in the circuit editor (TRACK_CHANGED) or another tab changes it (storage event).
import { useEffect, useState } from "react";
import { defaultRoutePoints, fetchSharedTrack, loadTrackRoute, TRACK_CHANGED, type TrackRoute } from "@/lib/track";

export function useTrackRoute(): TrackRoute {
  const [route, setRoute] = useState<TrackRoute>({ points: defaultRoutePoints, start: 13, finish: 13 });
  useEffect(() => {
    // Paint immediately from this browser's copy, then let the desk's copy win: the local one
    // is only ever a cache, and a stale drawing on a wall screen is worse than a moment's flicker.
    let alive = true;
    const reload = () => {
      setRoute(loadTrackRoute());
      void fetchSharedTrack().then((shared) => { if (alive && shared) setRoute(shared); });
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
