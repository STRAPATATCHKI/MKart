"use client";

// Kart avatar for the big-screen leaderboard: replaces the driver initials with a kart.
// The variant is picked from a hash of the driver (stable per driver) rather than Math.random,
// so the kart does NOT change on every leaderboard tick — it stays that driver's kart.
//
// Images: drop the four renders in  public/karts/  as
//   kart-blue.png  kart-black.png  kart-green.png  kart-white.png
// Until they exist, a built-in SVG kart is drawn in the matching colour.

import { useState } from "react";

export const KART_VARIANTS = ["blue", "black", "green", "white"] as const;
export type KartVariant = (typeof KART_VARIANTS)[number];

const VARIANT_COLORS: Record<KartVariant, { body: string; accent: string }> = {
  blue: { body: "#2b7de9", accent: "#14356b" },
  black: { body: "#32373f", accent: "#12151a" },
  green: { body: "#45c74a", accent: "#12521c" },
  white: { body: "#e9eef4", accent: "#7e8794" },
};

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable "random" kart for a driver (same driver always gets the same kart). */
export function kartVariantFor(seed: string): KartVariant {
  return KART_VARIANTS[hashSeed(seed || "?") % KART_VARIANTS.length];
}

function KartGlyph({ variant }: { variant: KartVariant }) {
  const { body, accent } = VARIANT_COLORS[variant];
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" style={{ width: "2.05em", height: "2.05em", display: "block" }}>
      {/* rear wheels */}
      <rect x="7" y="10" width="11" height="19" rx="4.5" fill="#1a1d22" />
      <rect x="46" y="10" width="11" height="19" rx="4.5" fill="#1a1d22" />
      {/* front wheels */}
      <rect x="3" y="35" width="13" height="22" rx="5.5" fill="#101317" />
      <rect x="48" y="35" width="13" height="22" rx="5.5" fill="#101317" />
      {/* chassis / side pods */}
      <path
        d="M20 20 h24 a5 5 0 0 1 5 5 v20 a6 6 0 0 1 -6 6 h-22 a6 6 0 0 1 -6 -6 v-20 a5 5 0 0 1 5 -5 z"
        fill={body}
      />
      {/* nose */}
      <path d="M24 51 l8 7 l8 -7 z" fill={body} />
      {/* seat */}
      <rect x="24" y="24" width="16" height="15" rx="5" fill={accent} />
      {/* steering */}
      <rect x="27" y="42" width="10" height="3.5" rx="1.75" fill={accent} />
    </svg>
  );
}

export function KartAvatar({ seed }: { seed: string }) {
  const variant = kartVariantFor(seed);
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) return <KartGlyph variant={variant} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/karts/kart-${variant}.png`}
      alt=""
      onError={() => setImgFailed(true)}
      style={{ width: "2.15em", height: "2.15em", objectFit: "contain", display: "block" }}
    />
  );
}
