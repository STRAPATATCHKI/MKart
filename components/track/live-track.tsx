"use client";

// Live track view: the karts driving MegaKart's own circuit, in their colours.
//
// WHAT IS REAL AND WHAT IS ESTIMATED - this matters, so it is stated plainly:
//
//   REAL      the loop is a SINGLE checkpoint - start and finish are the same physical point.
//             Every time a kart crosses it we learn, exactly: its lap count, its last lap time,
//             and when it crossed. That is the whole truth the hardware gives us. (More loops
//             around the track would give sector times and a much tighter position; with one,
//             this is the honest maximum.)
//   ESTIMATED where a kart is BETWEEN two crossings. Nothing measures that, so we assume a pace:
//               * a kart that has completed a lap keeps the pace of ITS OWN last lap
//               * a kart that has not yet - it has only just crossed for the first time - is
//                 given the field's average lap, because the rest of the grid is the best
//                 evidence available for how long a lap takes on this track today
//               * with nobody having lapped at all, a configured typical lap is used
//
// So a kart slides smoothly round the circuit and SNAPS back to the line on every real
// crossing. The snap is the truth correcting the guess; seeing it is a feature, not a glitch.
// A kart that is slower this lap simply arrives at the line a little after the animation
// predicted, and a kart that is faster arrives before - the estimate is clamped just short of
// the line so it never "finishes" a lap the hardware has not confirmed.
//
// Order is never guessed: laps and crossing order come from the timing engine, and the track
// only draws what it is told.
import { useEffect, useMemo, useRef, useState } from "react";
import type { TimingDriver } from "@/lib/timing-client";
import type { RoutePoint } from "@/lib/track";

export const PILOT_HEX: Record<number, string> = {
  1: "#8b5cf6", 2: "#f5d90a", 3: "#f97316", 4: "#45c74a",
  5: "#3a4048", 6: "#2b7de9", 7: "#e23b3b", 8: "#e9eef4",
};
const FALLBACK = ["#d8ff35", "#38e07b", "#2b7de9", "#e23b3b", "#f97316", "#8b5cf6", "#f5d90a", "#e9eef4"];
// The real fleet: four kart photos in public/karts, used untouched - no tinting, a kart looks
// like a kart. A pilot colour that matches one of the four gets that kart; everyone else is
// dealt one of the four by KART NUMBER, so all four appear on track and a given kart always
// looks the same from race to race. Exact identity is the coloured ring it sits on.
const KART_FLEET = [
  "/karts/kart-black.png",
  "/karts/kart-blue.png",
  "/karts/kart-green.png",
  "/karts/KartWhite.png",
];
const KART_BY_PILOT: Record<number, string> = {
  4: "/karts/kart-green.png",   // Vert
  5: "/karts/kart-black.png",   // Noir
  6: "/karts/kart-blue.png",    // Bleu
  8: "/karts/KartWhite.png",    // Blanc
};

function kartArt(pilot: number | null | undefined, kart: string | number | null | undefined): string {
  if (pilot != null && KART_BY_PILOT[pilot]) return KART_BY_PILOT[pilot];
  const number = Number(kart);
  const index = Number.isFinite(number) ? Math.abs(Math.trunc(number)) : 0;
  return KART_FLEET[index % KART_FLEET.length];
}

export type TrackDriver = TimingDriver & { color?: number | null; lastPassingAt?: number | null };

type Props = {
  drivers: TrackDriver[];
  points: RoutePoint[];
  start: number;
  width: number;
  height: number;
  running: boolean;
  /** Fraction of a lap a kart is held back from the line while its crossing is unconfirmed. */
  holdBack?: number;
  /** Typical lap for this track, used only until somebody has actually set one. */
  typicalLapMs?: number;
};

type Placed = { driver: TrackDriver; x: number; y: number; angle: number; colour: string;
                pilot: number | null; progress: number };

/** Cumulative-length table so a 0..1 fraction maps to a real point on the polyline. */
function measure(points: RoutePoint[], start: number) {
  const n = points.length;
  if (n < 2) return { lengths: [0], total: 0, ordered: points };
  // Rotate so the start/finish marker is fraction 0 - the one place we have real data.
  const ordered = points.map((_, i) => points[(start + i) % n]);
  const closed = [...ordered, ordered[0]];
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < closed.length; i++) {
    total += Math.hypot(closed[i].x - closed[i - 1].x, closed[i].y - closed[i - 1].y);
    lengths.push(total);
  }
  return { lengths, total, ordered: closed };
}

function pointAt(fraction: number, table: ReturnType<typeof measure>) {
  const { lengths, total, ordered } = table;
  if (total === 0 || ordered.length < 2) return { x: ordered[0]?.x ?? 0, y: ordered[0]?.y ?? 0, angle: 0 };
  const target = ((fraction % 1) + 1) % 1 * total;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < target) i++;
  const segment = lengths[i] - lengths[i - 1] || 1;
  const t = (target - lengths[i - 1]) / segment;
  const a = ordered[i - 1];
  const b = ordered[i];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}

export function LiveTrack({ drivers, points, start, width, height, running, holdBack = 0.03,
                            typicalLapMs = 35_000 }: Props) {
  const table = useMemo(() => measure(points, start), [points, start]);
  const path = useMemo(
    () => table.ordered.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" "),
    [table],
  );
  // One animation frame drives every kart; state holds only the clock so React work stays small.
  const [now, setNow] = useState(() => Date.now());
  const frame = useRef(0);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      frame.current = window.requestAnimationFrame(tick);
    };
    frame.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame.current);
  }, []);

  // The pace to assume for a kart that has not set a lap of its own yet: what the rest of the
  // field is actually doing right now. Real laps beat any constant we could pick.
  const referenceLapMs = useMemo(() => {
    const known = drivers
      .map((d) => d.lastLapMs)
      .filter((value): value is number => value != null && value > 0);
    if (!known.length) return typicalLapMs;
    return known.reduce((total, value) => total + value, 0) / known.length;
  }, [drivers, typicalLapMs]);

  const placed: Placed[] = useMemo(() => {
    return drivers.map((driver, index) => {
      const colour = driver.color ? PILOT_HEX[driver.color] ?? FALLBACK[index % 8] : FALLBACK[index % 8];
      let fraction = 0;
      if (driver.lastPassingAt != null && running) {
        // This kart's own last lap if it has one; otherwise the field's average, which is the
        // best evidence we have until it completes its first lap and speaks for itself.
        const pace = driver.lastLapMs != null && driver.lastLapMs > 0 ? driver.lastLapMs : referenceLapMs;
        // Clamped just short of the line: the animation never claims a lap the loop has not
        // confirmed, so a slow lap simply waits at the line for the real crossing.
        fraction = Math.min((now - driver.lastPassingAt) / pace, 1 - holdBack);
      } else if (driver.grid != null) {
        // Not started: line up on the grid, just behind the start line, in grid order.
        fraction = 1 - holdBack - (driver.grid - 1) * 0.012;
      }
      const at = pointAt(fraction, table);
      return { driver, ...at, colour, pilot: driver.color ?? null, progress: (driver.laps ?? 0) + fraction };
    });
  }, [drivers, now, running, table, holdBack, referenceLapMs]);

  // Draw the leader last so it sits on top when karts overlap.
  const ordered = [...placed].sort((a, b) => a.progress - b.progress);
  const line = pointAt(0, table);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="live-track"
         role="img" aria-label="Position des karts sur le circuit">
      <path d={path} fill="none" stroke="#1d2530" strokeWidth={26} strokeLinecap="round" strokeLinejoin="round" />
      <path d={path} fill="none" stroke="#2b3644" strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" />
      <path d={path} fill="none" stroke="#141a22" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" />
      <path d={path} fill="none" stroke="#3a4450" strokeWidth={1.5} strokeDasharray="7 9" opacity={0.5} />

      {/* The one checkpoint: start AND finish, because the loop is a single detection point. */}
      <g transform={`translate(${line.x} ${line.y}) rotate(${line.angle})`}>
        <rect x={-3} y={-15} width={6} height={30} fill="#e9eef4" />
        <rect x={-3} y={-15} width={6} height={5} fill="#0b0e05" />
        <rect x={-3} y={-5} width={6} height={5} fill="#0b0e05" transform="translate(0,10)" />
        <text y={-22} textAnchor="middle" fill="#d8ff35" fontSize={11} fontWeight={700} transform={`rotate(${-line.angle})`}>
          DÉPART / ARRIVÉE
        </text>
      </g>

      {ordered.map(({ driver, x, y, angle, colour, pilot }) => {
        const leader = driver.position === 1;
        return (
          <g key={driver.transponder} transform={`translate(${x} ${y})`} className="live-track-kart">
            {/* The kart art stays exactly as drawn - a kart should look like a kart. Identity
                lives in the ring it sits on: a coloured halo and rim in the pilot's colour,
                which also lifts a dark kart off the dark tarmac. */}
            <circle r={15} fill={colour} opacity={0.22} />
            <circle r={15} fill="none" stroke={colour} strokeWidth={2.5} opacity={0.95} />
            {leader && <circle r={19.5} fill="none" stroke="#d8ff35" strokeWidth={1.5} opacity={0.9} />}
            {/* The art points nose-DOWN in the source image, and the heading is measured along
                +x, so -90 puts the nose into the direction of travel. */}
            <image href={kartArt(pilot, driver.kart)} x={-13} y={-13} width={26} height={26}
                   transform={`rotate(${angle - 90})`} style={{ imageRendering: "auto" }} />
            {/* The kart's own colour identifies it, so only the driver's name is written. */}
            <text y={24} textAnchor="middle" fontSize={10} fontWeight={700}
                  fill={colour} stroke="#0b0e05" strokeWidth={0.7} paintOrder="stroke">
              {driver.driver}
            </text>
          </g>
        );
      })}

      {drivers.length === 0 && (
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#5d6b8a" fontSize={14}>
          Aucun kart en piste
        </text>
      )}
    </svg>
  );
}
