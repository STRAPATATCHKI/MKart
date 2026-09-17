// Single source of truth for the MegaKart track layout, shared by the live-race circuit
// editor (RaceCircuitMap) and the Home-page mini map (TrackMap). The operator adjusts the
// track once; both views render the exact same shape. Later this same route drives the
// kart animation (positions along the path).

export type RoutePoint = { x: number; y: number };

export const TRACK_WIDTH = 704;
export const TRACK_HEIGHT = 268;
export const LEGACY_TRACK_WIDTH = 560;
export const TRACK_LAYOUT_VERSION = 2;
export const TRACK_STORAGE_KEY = "megakart-track-layout";
export const TRACK_CHANGED = "mk-track-changed";

export const defaultRoutePoints: RoutePoint[] = [
  { x: 73, y: 191 }, { x: 50, y: 135 }, { x: 76, y: 82 }, { x: 126, y: 70 },
  { x: 177, y: 104 }, { x: 224, y: 96 }, { x: 264, y: 45 }, { x: 319, y: 37 },
  { x: 369, y: 85 }, { x: 425, y: 92 }, { x: 488, y: 103 }, { x: 510, y: 160 },
  { x: 474, y: 205 }, { x: 408, y: 201 }, { x: 354, y: 178 }, { x: 301, y: 210 },
  { x: 246, y: 215 }, { x: 198, y: 181 }, { x: 150, y: 168 }, { x: 111, y: 201 },
].map((point) => ({ ...point, x: point.x * (TRACK_WIDTH / LEGACY_TRACK_WIDTH) }));

// Smooth closed loop through the control points (quadratic segments), used to draw the track.
export function makeSmoothRoute(points: RoutePoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  const midpoint = (a: RoutePoint, b: RoutePoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const first = midpoint(points[points.length - 1], points[0]);
  return `M ${first.x} ${first.y} ` + points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const mid = midpoint(point, next);
    return `Q ${point.x} ${point.y} ${mid.x} ${mid.y}`;
  }).join(" ") + " Z";
}

export interface TrackRoute {
  points: RoutePoint[];
  start: number;
  finish: number;
}

const DEFAULT_ROUTE: TrackRoute = { points: defaultRoutePoints, start: 13, finish: 13 };

// Read the saved track (with legacy-version migration), or the default. SSR-safe when called
// from an effect.
export function loadTrackRoute(): TrackRoute {
  try {
    const saved = localStorage.getItem(TRACK_STORAGE_KEY);
    if (!saved) return DEFAULT_ROUTE;
    const parsed = JSON.parse(saved) as { version?: number; points?: RoutePoint[]; start?: number; finish?: number };
    if (!Array.isArray(parsed.points) || parsed.points.length < 3) return DEFAULT_ROUTE;
    const points = parsed.version === TRACK_LAYOUT_VERSION
      ? parsed.points
      : parsed.points.map((p) => ({ ...p, x: p.x * (TRACK_WIDTH / LEGACY_TRACK_WIDTH) }));
    return {
      points,
      start: typeof parsed.start === "number" ? parsed.start : DEFAULT_ROUTE.start,
      finish: typeof parsed.finish === "number" ? parsed.finish : DEFAULT_ROUTE.finish,
    };
  } catch {
    return DEFAULT_ROUTE;
  }
}

// Tell other on-screen views (the Home mini map) that the track was edited.
export function notifyTrackChanged() {
  try {
    window.dispatchEvent(new Event(TRACK_CHANGED));
  } catch {
    /* non-browser */
  }
}
