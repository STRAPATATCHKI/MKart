"use client";

// Small copy button with honest feedback: it says "Copié" only when the copy actually
// succeeded, and says so plainly when it did not. A button that always claims success is
// worse than no button — the operator walks to GoKarts and pastes nothing.

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

export function CopyButton({ text, label, title, className = "" }: {
  text: string;
  label: string;
  title?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const run = async () => {
    const ok = await copyText(text);
    setState(ok ? "done" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2200);
  };

  return (
    <button
      type="button"
      className={`fa-copy is-${state} ${className}`.trim()}
      onClick={() => void run()}
      disabled={!text.trim()}
      title={title ?? label}
    >
      {state === "done" ? "Copié ✓" : state === "failed" ? "Échec — sélectionnez à la main" : label}
    </button>
  );
}
