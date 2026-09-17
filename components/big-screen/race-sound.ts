"use client";

// Tiny synthesized sound kit (WebAudio, no assets) for the big screen: start lights, GO,
// fastest lap, last lap bell, chequered flag and the podium fanfare.
import { useEffect, useMemo, useRef } from "react";

type ToneOptions = { type?: OscillatorType; gain?: number; delay?: number; slide?: number };

export type RaceSound = ReturnType<typeof useRaceSound>;

export function useRaceSound(muted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  return useMemo(() => {
    const context = () => {
      if (!ctxRef.current) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        ctxRef.current = new AC();
      }
      if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
      return ctxRef.current;
    };

    const tone = (freq: number, duration: number, { type = "square", gain = 0.07, delay = 0, slide }: ToneOptions = {}) => {
      if (mutedRef.current) return;
      const ctx = context();
      if (!ctx) return;
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + duration);
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(amp).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.03);
    };

    return {
      unlock: () => void context(),
      light: () => tone(440, 0.24),
      go: () => { tone(880, 0.55, { gain: 0.09 }); tone(1320, 0.5, { type: "triangle", gain: 0.05 }); },
      best: () => { tone(1320, 0.12, { type: "sine", gain: 0.09 }); tone(1760, 0.2, { type: "sine", gain: 0.07, delay: 0.1 }); },
      leader: () => tone(260, 0.38, { type: "sawtooth", gain: 0.04, slide: 900 }),
      bell: () => [0, 0.2, 0.4].forEach((delay) => tone(988, 0.15, { type: "triangle", gain: 0.09, delay })),
      flag: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.24, { type: "triangle", gain: 0.09, delay: i * 0.12 })),
      drum: () => { tone(120, 0.18, { type: "triangle", gain: 0.16, slide: 60 }); tone(180, 0.08, { type: "square", gain: 0.03 }); },
      fanfare: () =>
        ([[523, 0], [659, 0.14], [784, 0.28], [1047, 0.42], [784, 0.66], [1047, 0.8], [1319, 0.96]] as const).forEach(([f, delay]) =>
          tone(f, delay === 0.96 ? 0.7 : 0.26, { type: "triangle", gain: 0.1, delay }),
        ),
    };
  }, []);
}
