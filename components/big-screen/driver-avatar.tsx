"use client";

// Shows the pilot a player picked when they signed up (public/drivers/driver-1..8.png).
// Without a pick — a walk-in typed straight into a session — it falls back to the kart avatar.
import { useState } from "react";
import { KartAvatar } from "./kart-avatar";

export const DRIVER_PILOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const PILOT_LABELS: Record<number, string> = {
  1: "Violet", 2: "Jaune", 3: "Orange", 4: "Vert", 5: "Noir", 6: "Bleu", 7: "Rouge", 8: "Blanc",
};

export function DriverAvatar({ pilot, seed, size = "2.15em" }: { pilot?: number | null; seed: string; size?: string }) {
  const [failed, setFailed] = useState(false);
  const valid = pilot != null && pilot >= 1 && pilot <= 8;

  if (!valid || failed) return <KartAvatar seed={seed} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/drivers/driver-${pilot}.png`}
      alt=""
      onError={() => setFailed(true)}
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
    />
  );
}
