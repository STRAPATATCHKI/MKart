"use client";

// Reactive access to the shared MegaKart track layout. Re-reads when the operator saves an
// edit in the circuit editor (TRACK_CHANGED) or another tab changes it (storage event).
import { useEffect, useState } from "react";
import { defaultRoutePoints, loadTrackRoute, TRACK_CHANGED, type TrackRoute } from "@/lib/track";

export function useTrackRoute(): TrackRoute {
  const [route, setRoute] = useState<TrackRoute>({ points: defaultRoutePoints, start: 13, finish: 13 });
  useEffect(() => {
    const reload = () => setRoute(loadTrackRoute());
    reload();
    window.addEventListener(TRACK_CHANGED, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(TRACK_CHANGED, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  return route;
}
