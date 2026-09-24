"use client";

// The reservation queue, as the caisse sees it.
//
// Talks to the desk server (tools/reservations/desk.mjs) same-origin: in production the desk
// serves this bundle, in dev Vite proxies /api to it. So there is no bridge URL here and no
// CORS to configure.

import { useCallback, useEffect, useRef, useState } from "react";

export type QueueStatus = "EN_ATTENTE" | "AU_GUICHET" | "PAYEE" | "EN_PISTE" | "TERMINEE" | "ABSENT" | "ANNULEE" | "SUPPRIMEE";

export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  EN_ATTENTE: "En attente",
  AU_GUICHET: "Au guichet",
  PAYEE: "Payée",
  EN_PISTE: "En piste",
  TERMINEE: "Terminée",
  ABSENT: "Absent",
  ANNULEE: "Annulée",
  SUPPRIMEE: "Supprimée",
};

export type QueuePilot = {
  id: string;
  fullName: string;
  kartColor: "blue" | "black" | "green";
  kartNumber: number | null;
};

export type Reservation = {
  id: string;
  code: string;
  channel: "enligne" | "guichet";
  contactName: string;
  phone: string;
  email: string | null;
  raceType: string;
  pilots: QueuePilot[];
  paymentMethod: "Espèces" | "Carte bancaire";
  status: QueueStatus;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
  paidBy: string | null;
  /** Dirhams actually collected. Null on reservations cashed before amounts were recorded. */
  paidAmount?: number | null;
  /** When the client paid two ways: the cash part and the card part (their sum is paidAmount). */
  paidSplit?: { cash: number; card: number } | null;
  /** In the bin (status SUPPRIMEE): when, by whom, and the status "Restaurer" puts back. */
  deletedAt?: string | null;
  deletedBy?: string | null;
  deletedFrom?: QueueStatus | null;
  /** The pack as corrected at the counter, priced by the desk from the catalog. Null: the client's own choice. */
  packOverride?: PackOverride | null;
  sessionId: string | null;
};

export type PackOverride = {
  id: string;
  label: string;
  basis: "personne" | "groupe";
  price: number;
  total: number | null;
  pilots: number;
  /** Whether the offer is meant for this many pilots; the cashier may choose one that is not. */
  fits: boolean;
  by: string | null;
  at: string;
};

export type QueueView = {
  reservations: Reservation[];
  /** desk server reachable — distinct from "the queue is empty" */
  online: boolean;
  loading: boolean;
  error: string | null;
  lastSync: string | null;
  refresh: () => Promise<void>;
  pay: (code: string, mode: Reservation["paymentMethod"], by: string, amount: number | null,
        split?: { cash: number; card: number } | null) => Promise<void>;
  unpay: (code: string) => Promise<void>;
  setStatus: (code: string, status: QueueStatus) => Promise<void>;
  assignKarts: (code: string, karts: Record<string, number>, sessionId?: string) => Promise<void>;
  /** To the Supprimées page, back from it, or erased for good (only from there). */
  remove: (code: string, by: string) => Promise<void>;
  restore: (code: string) => Promise<void>;
  erase: (code: string) => Promise<void>;
  /** Change the pack at the counter; null returns to the client's own choice. */
  setPack: (code: string, offerId: string | null, by: string) => Promise<void>;
  addWalkIn: (input: { contactName: string; phone?: string; pilots: { fullName: string; kartColor: string }[]; paymentMethod: string }) => Promise<Reservation | null>;
};

export function useQueue(pollMs = 4000): QueueView {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/queue", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (!alive.current) return;
      setReservations(Array.isArray(j.reservations) ? j.reservations : []);
      setOnline(true);
      setError(null);
      setLastSync(new Date().toISOString());
    } catch {
      if (!alive.current) return;
      // Deliberately keep the last known rows on screen. Replacing them with an empty list
      // would make a dead desk server look exactly like a quiet Saturday.
      setOnline(false);
      setError("Borne de réservation injoignable — la liste n’est plus à jour.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    return () => { alive.current = false; clearInterval(t); };
  }, [refresh, pollMs]);

  const act = useCallback(async (code: string, action: string, body: unknown) => {
    // Optimistic: the desk must feel instant. On failure we refresh, so the screen always
    // ends up showing what the server actually believes.
    try {
      const r = await fetch(`/api/queue/${encodeURIComponent(code)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!r.ok) throw new Error(String(r.status));
      const updated: Reservation = await r.json();
      setReservations((list) => list.map((x) => (x.code === code ? updated : x)));
      setError(null);
    } catch {
      setError("Action non enregistrée. Vérifiez la borne et réessayez.");
      void refresh();
    }
  }, [refresh]);

  return {
    reservations,
    online,
    loading,
    error,
    lastSync,
    refresh,
    pay: useCallback((code, mode, by, amount, split) => act(code, "paiement",
      { mode, par: by, montant: amount, ...(split ? { especes: split.cash, carte: split.card } : {}) }), [act]),
    unpay: useCallback((code) => act(code, "annuler-paiement", {}), [act]),
    setStatus: useCallback((code, statut) => act(code, "statut", { statut }), [act]),
    assignKarts: useCallback((code, karts, sessionId) => act(code, "karts", { karts, sessionId }), [act]),
    setPack: useCallback((code, offerId, by) => act(code, "formule", { offerId, par: by }), [act]),
    remove: useCallback((code, by) => act(code, "supprimer", { par: by }), [act]),
    restore: useCallback((code) => act(code, "restaurer", {}), [act]),
    erase: useCallback(async (code: string) => {
      try {
        const r = await fetch(`/api/queue/${encodeURIComponent(code)}/effacer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!r.ok) throw new Error(String(r.status));
        setReservations((list) => list.filter((x) => x.code !== code));
        setError(null);
      } catch {
        setError("Effacement non enregistré. Vérifiez la borne et réessayez.");
        void refresh();
      }
    }, [refresh]),
    addWalkIn: useCallback(async (input) => {
      try {
        const r = await fetch("/api/reservations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, channel: "guichet" }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || String(r.status));
        const created: Reservation = await r.json();
        setReservations((l) => [created, ...l]);
        return created;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Création impossible.");
        return null;
      }
    }, []),
  };
}
