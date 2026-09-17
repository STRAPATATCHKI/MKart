"use client";

// Fuel barrel gauge. The liquid rises and falls with the stock (animated), two waves drift across
// its surface at different speeds, and bubbles climb through it. Drawn as SVG so it stays sharp
// on the office screen and on the venue TV.
import { useId } from "react";

const W = 200; // drawing width
const H = 260; // drawing height
const TOP = 26; // inner liquid area
const BOTTOM = 246;
const INNER = BOTTOM - TOP;

const BUBBLES = [
  { x: 52, r: 3.4, delay: 0, duration: 5.2 },
  { x: 88, r: 2.2, delay: 1.4, duration: 6.4 },
  { x: 124, r: 4, delay: 2.6, duration: 4.6 },
  { x: 152, r: 2.6, delay: 3.8, duration: 7 },
];

export function FuelBarrel({ level, low }: { level: number; low: boolean }) {
  const id = useId().replace(/:/g, "");
  const clamped = Math.min(1, Math.max(0, level));
  // The liquid group sits at the top of the barrel and is pushed down by the empty share.
  const drop = (1 - clamped) * INNER;

  return (
    <svg className={"fb" + (low ? " is-low" : "")} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cuve à ${Math.round(clamped * 100)} %`}>
      <defs>
        <linearGradient id={`${id}-steel`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#171c15" />
          <stop offset="0.18" stopColor="#2c3429" />
          <stop offset="0.5" stopColor="#3b4536" />
          <stop offset="0.82" stopColor="#242b20" />
          <stop offset="1" stopColor="#12160f" />
        </linearGradient>
        <linearGradient id={`${id}-fuel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--fuel-top)" />
          <stop offset="1" stopColor="var(--fuel-bottom)" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-inner`}>
          <rect x="18" y={TOP} width={W - 36} height={INNER} rx="16" />
        </clipPath>
      </defs>

      {/* barrel body */}
      <rect x="10" y="14" width={W - 20} height={H - 28} rx="22" fill={`url(#${id}-steel)`} stroke="#4a5643" strokeWidth="2" />

      {/* liquid */}
      <g clipPath={`url(#${id}-inner)`}>
        <g className="fb-liquid" style={{ transform: `translateY(${drop}px)` }}>
          <g className="fb-wave fb-wave--back">
            <path d={`M0 16 C 25 4, 75 4, 100 16 S 175 28, 200 16 S 275 4, 300 16 S 375 28, 400 16 V ${H} H0 Z`} fill={`url(#${id}-fuel)`} opacity="0.55" />
          </g>
          <g className="fb-wave fb-wave--front">
            <path d={`M0 22 C 30 12, 70 32, 100 22 S 170 12, 200 22 S 270 32, 300 22 S 370 12, 400 22 V ${H} H0 Z`} fill={`url(#${id}-fuel)`} />
          </g>
          <g className="fb-bubbles">
            {BUBBLES.map((bubble) => (
              <circle
                key={bubble.x}
                className="fb-bubble"
                cx={bubble.x}
                cy={BOTTOM}
                r={bubble.r}
                style={{ animationDelay: `${bubble.delay}s`, animationDuration: `${bubble.duration}s` }}
              />
            ))}
          </g>
        </g>
      </g>

      {/* glass shine + hoops */}
      <rect x="18" y={TOP} width="46" height={INNER} rx="16" fill={`url(#${id}-shine)`} />
      {[70, 130, 190].map((y) => (
        <rect key={y} x="10" y={y} width={W - 20} height="9" rx="4" fill="#0e120c" opacity="0.55" />
      ))}
      <rect x="10" y="14" width={W - 20} height={H - 28} rx="22" fill="none" stroke="rgba(216,255,53,.25)" strokeWidth="1.5" />

      {/* level ticks */}
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = BOTTOM - tick * INNER;
        return (
          <g key={tick} className="fb-tick">
            <line x1={W - 34} y1={y} x2={W - 18} y2={y} />
            <text x={W - 40} y={y + 3.5} textAnchor="end">{Math.round(tick * 100)}</text>
          </g>
        );
      })}
    </svg>
  );
}
