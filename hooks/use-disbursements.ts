"use client";

// Décaissements from the desk (this PC only): read every 5 s, so an approval or a refusal sent
// from the manager's app shows up here by itself, a few seconds after it was given.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Disbursement, NewDisbursement } from "@/lib/disbursements";

export function useDisbursements(pollMs = 5000) {
  const [list, setList] = useState<Disbursement[]>([]);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/disbursements", { cache: "no-store" });
      if (!res.ok || !(res.headers.get("content-type") || "").includes("application/json")) throw new Error(String(res.status));
      const body = (await res.json()) as { disbursements?: Disbursement[] };
      if (!alive.current) return;
      setList(Array.isArray(body.disbursements) ? body.disbursements : []);
      setOnline(true);
    } catch {
      if (alive.current) setOnline(false);   // keep what is on screen: a closed desk is not "no requests"
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(() => void refresh(), 0);
    const t = window.setInterval(() => void refresh(), pollMs);
    return () => { alive.current = false; window.clearTimeout(first); window.clearInterval(t); };
  }, [refresh, pollMs]);

  /** Sends to the desk; resolves to the saved request, or to why it was refused. */
  const send = useCallback(async (url: string, body: unknown): Promise<Disbursement | string> => {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as (Disbursement & { error?: string }) | null;
      if (!res.ok || !data || data.error) {
        return data?.error === "Route inconnue." || !data ? "Serveur d’accueil trop ancien : appuyez sur Synchroniser, puis réessayez." : data.error ?? "Refusé par l’accueil.";
      }
      void refresh();
      return data;
    } catch {
      return "Accueil injoignable : réessayez dans un instant.";
    }
  }, [refresh]);

  return {
    list, online, loading, refresh,
    create: (input: NewDisbursement) => send("/api/disbursements", input),
    cancel: (id: string, by: string, reason: string) => send(`/api/disbursements/${encodeURIComponent(id)}/annuler`, { by, reason }),
    payOut: (id: string, by: string, note: string) => send(`/api/disbursements/${encodeURIComponent(id)}/decaisse`, { by, note }),
    addPhotos: (id: string, attachments: string[], by: string) => send(`/api/disbursements/${encodeURIComponent(id)}/pieces`, { attachments, by }),
  };
}
