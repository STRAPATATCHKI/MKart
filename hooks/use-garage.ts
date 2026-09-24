"use client";

// The spare-parts shelf as the desk holds it (GET/PUT /api/garage, this PC only). Same three
// honest states as the catalog: "desk" (saved there), "seed" (the desk has none yet: the first
// save creates it), "readonly" (desk unreachable or too old - saving is refused, not faked).

import { useCallback, useEffect, useState } from "react";
import { normalizeGarage, SEED_GARAGE, type Garage } from "@/lib/garage-parts";

export type GarageSource = "loading" | "desk" | "seed" | "readonly";

export function useGarage() {
  const [garage, setGarage] = useState<Garage>(SEED_GARAGE);
  const [source, setSource] = useState<GarageSource>("loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/garage", { cache: "no-store" });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.includes("application/json")) { setSource("readonly"); return; }
      const body = (await res.json()) as { parts?: unknown } | null;
      if (!body || !Array.isArray(body.parts)) { setGarage(SEED_GARAGE); setSource("seed"); return; }
      setGarage(normalizeGarage(body));
      setSource("desk");
    } catch {
      setSource("readonly");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  const save = useCallback(async (next: Garage): Promise<boolean> => {
    if (source === "readonly") {
      setError("Serveur d’accueil trop ancien ou injoignable : appuyez sur Synchroniser, puis réessayez.");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/garage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeGarage(next)),
      });
      const body = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
      if (!res.ok) { setError((body && body.error) || `Enregistrement refusé (${res.status}).`); return false; }
      setGarage(normalizeGarage(body));
      setSource("desk");
      return true;
    } catch {
      setError("Serveur d’accueil injoignable : rien n’a été enregistré.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [source]);

  return { garage, source, saving, error, save, reload: () => void load() };
}
