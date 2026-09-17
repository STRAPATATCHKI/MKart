"use client";

// The stable kart ↔ transponder table, from the bridge.
//
// This is equipment data, not session data: the transponder is bolted into the kart. Once it
// is filled in, operators only ever deal with kart numbers and never retype a transponder.

import { useCallback, useEffect, useState } from "react";

const BRIDGE_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_APEX_BRIDGE_URL) ||
  "http://localhost:8787";

export type KartEntry = { transponder: string; label?: string; active?: boolean; updatedAt?: string | null };

export type KartMapView = {
  karts: Record<string, KartEntry>;
  /** transponders seen passing that belong to no kart yet — the easy way to build the table */
  unmapped: string[];
  online: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (karts: Record<string, KartEntry>) => Promise<boolean>;
  kartFor: (transponder: string) => string | null;
};

export function useKartMap(): KartMapView {
  const [karts, setKarts] = useState<Record<string, KartEntry>>({});
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${BRIDGE_URL}/karts`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setKarts(j.karts || {});
      setUnmapped(Array.isArray(j.unmapped) ? j.unmapped : []);
      setOnline(true);
      setError(null);
    } catch {
      setOnline(false);
      setError("Pont de chronométrage injoignable — mappage des karts indisponible.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 10000);
    return () => clearInterval(t);
  }, [refresh]);

  const save = useCallback(async (next: Record<string, KartEntry>) => {
    try {
      const r = await fetch(`${BRIDGE_URL}/karts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ karts: next }),
      });
      if (!r.ok) {
        // The bridge rejects duplicates rather than merging them — surface its reason verbatim.
        setError(await r.text().catch(() => "Enregistrement refusé."));
        return false;
      }
      const j = await r.json();
      setKarts(j.karts || {});
      setError(null);
      return true;
    } catch {
      setError("Enregistrement impossible : le pont ne répond pas.");
      return false;
    }
  }, []);

  const kartFor = useCallback((transponder: string) => {
    for (const [k, v] of Object.entries(karts)) if (v.transponder === String(transponder)) return k;
    return null;
  }, [karts]);

  return { karts, unmapped, online, error, refresh, save, kartFor };
}
