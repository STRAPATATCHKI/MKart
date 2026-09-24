"use client";

// The traffic behind the logo on the idle screen.
//
// Not a loop. A director: every so often it picks a scene at random - a lone kart, a pair with
// an overtake, or a small pack with a pass inside it - with random karts and a random pause
// before the next one. The pauses are long on purpose. This is what hangs on the wall between
// races; the logo is the subject, and a kart going by now and then is what keeps it alive.
//
// Each scene's animations run once. React mounts fresh elements per scene, so nothing needs
// resetting and a scene can never start half-way through the previous one.
import { useEffect, useState } from "react";

const FLEET = ["kart-green", "kart-blue", "kart-black", "KartWhite"];

/** How long a scene is on screen, and the same figure in the CSS animations. */
const SCENE_MS = 4400;
/** The quiet time after a scene, before the next one is even chosen. */
const QUIET_MIN_MS = 11_000;
const QUIET_MAX_MS = 26_000;

type Role = "lead" | "lead-low" | "chase";
type Scene = { id: number; karts: { name: string; role: Role; delay: number }[] };

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick the next scene. Weighted towards the small ones: a lone kart most often, a pair with an
 * overtake nearly as often, the pack only sometimes - a wall that is always busy stops being
 * looked at.
 */
function nextScene(id: number): Scene {
  const karts = shuffle(FLEET);
  const roll = Math.random();
  if (roll < 0.42) {
    return { id, karts: [{ name: karts[0], role: "lead", delay: 0 }] };
  }
  if (roll < 0.82) {
    return { id, karts: [
      { name: karts[0], role: "lead", delay: 0 },
      { name: karts[1], role: "chase", delay: 0 },
    ] };
  }
  // The pack: one pass inside it, the others strung out behind so nobody touches anybody.
  // The low-row kart enters late enough that the chaser has flicked back in before it arrives.
  const size = Math.random() < 0.5 ? 3 : 4;
  const pack: Scene["karts"] = [
    { name: karts[0], role: "lead", delay: 0 },
    { name: karts[1], role: "chase", delay: 0 },
    { name: karts[2], role: "lead-low", delay: 1100 },
  ];
  if (size === 4) pack.push({ name: karts[3], role: "lead", delay: 2300 });
  return { id, karts: pack };
}

export function IntroTraffic({ active }: { active: boolean }) {
  const [scene, setScene] = useState<Scene | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    if (!active) {
      // Clear on the next tick rather than inside the effect body: the lint rule is right that
      // a synchronous set here cascades, and a frame of delay is invisible on a wall.
      timer = window.setTimeout(() => { if (!cancelled) setScene(null); }, 0);
      return () => { cancelled = true; window.clearTimeout(timer); };
    }
    let id = 0;
    const quiet = () => QUIET_MIN_MS + Math.random() * (QUIET_MAX_MS - QUIET_MIN_MS);
    const play = () => {
      if (cancelled) return;
      id += 1;
      const next = nextScene(id);
      setScene(next);
      const longest = Math.max(...next.karts.map((k) => k.delay)) + SCENE_MS;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        setScene(null);
        timer = window.setTimeout(play, quiet());
      }, longest);
    };
    // A short first wait so the logo lands before anything drives through it.
    timer = window.setTimeout(play, 2500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active]);

  if (!scene) return <div className="bs-intro-track" aria-hidden="true" />;
  return (
    <div className="bs-intro-track" aria-hidden="true">
      {scene.karts.map((kart, i) => (
        <div
          key={`${scene.id}-${i}`}
          className={`bs-intro-lane bs-intro-lane--${kart.role}`}
          style={{ animationDelay: `${kart.delay}ms` }}
        >
          <i className="bs-intro-draft" />
          <img src={`/karts/${kart.name}.png`} alt="" style={{ animationDelay: `${kart.delay}ms` }} />
        </div>
      ))}
    </div>
  );
}
