"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#d8ff35", "#f4f6ed", "#c9d1d7", "#8fd51e", "#e0924f"];

type Particle = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; w: number; h: number; color: string; wobble: number };

// Canvas confetti: two side cannons and a centre burst when `active` flips on, then a light
// continuous rain for as long as the podium is on screen.
export function Confetti({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!active || !canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const particles: Particle[] = [];
    const spawn = (x: number, y: number, angle: number, spread: number, speed: number) => {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.45 + Math.random() * 0.75);
      const size = height * (0.008 + Math.random() * 0.008);
      particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        w: size, h: size * (0.4 + Math.random() * 0.5), color: COLORS[(Math.random() * COLORS.length) | 0], wobble: Math.random() * 10,
      });
    };
    const speed = height * 0.034;
    for (let i = 0; i < 160; i++) spawn(0, height * 0.95, -Math.PI / 3.2, 0.7, speed);
    for (let i = 0; i < 160; i++) spawn(width, height * 0.95, -Math.PI + Math.PI / 3.2, 0.7, speed);
    for (let i = 0; i < 120; i++) spawn(width / 2, height * 0.42, -Math.PI / 2, Math.PI * 1.6, speed * 0.7);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(48, now - last) / 16.67;
      last = now;
      if (Math.random() < 0.35 * dt) spawn(Math.random() * width, -20, Math.PI / 2, 0.4, height * 0.004);
      ctx.clearRect(0, 0, width, height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += height * 0.00032 * dt;
        p.vx *= Math.pow(0.985, dt);
        p.vy *= Math.pow(0.985, dt);
        p.x += (p.vx + Math.sin((p.wobble += 0.08 * dt)) * 0.6) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y > height + 40) {
          particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.wobble));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      ctx.clearRect(0, 0, width, height);
    };
  }, [active]);

  return <canvas ref={ref} className="bs-confetti" aria-hidden="true" />;
}
