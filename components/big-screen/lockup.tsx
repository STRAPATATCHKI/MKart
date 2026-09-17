import type { CSSProperties } from "react";

// MegaKart logo with the loader wheel spinning behind it (same lockup as the page transition).
export function Lockup({ className = "", spin }: { className?: string; spin?: string }) {
  return (
    <div className={"bs-lockup " + className} style={spin ? ({ "--spin": spin } as CSSProperties) : undefined} role="img" aria-label="MegaKart">
      <div className="bs-lockup-wheel" aria-hidden="true"><i /></div>
      <div className="bs-lockup-logo" />
    </div>
  );
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
