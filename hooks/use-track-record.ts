"use client";

// The track record as the desk holds it (GET /api/record, public; PUT from this PC only).
// Falls back to DEFAULT_RECORD (23.594) when the desk has none yet or cannot be reached, so the
// TV always has a record to chase.

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_RECORD, normalizeRecord, type TrackRecord } from "@/lib/track-record";

export type TrackRecordView = {
  record: TrackRecord;
  /** "desk": saved on the desk; "default": the built-in 23.594, nothing saved yet. */
  source: "desk" | "default";
  saving: boolean;
  error: string | null;
  save: (next: { lapMs: number; driver: string | null }) => Promise<boolean>;
};

export function useTrackRecord(pollMs = 60_000): TrackRecordView {
  const [record, setRecord] = useState<TrackRecord>(DEFAULT_RECORD);
  const [source, setSource] = useState<"desk" | "default">("default");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/record", { cache: "no-store" });
      if (!res.ok || !(res.headers.get("content-type") || "").includes("application/json")) return;
      const saved = normalizeRecord(await res.json());
      if (saved) { setRecord(saved); setSource("desk"); }
    } catch { /* keep what we have */ }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => void load(), pollMs);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [load, pollMs]);

  const save = useCallback(async (next: { lapMs: number; driver: string | null }) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/record", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
      if (!res.ok) {
        setError(res.status === 404 || res.status === 405
          ? "Serveur d’accueil trop ancien : appuyez sur Synchroniser, puis réessayez."
          : (body && body.error) || `Enregistrement refusé (${res.status}).`);
        return false;
      }
      const saved = normalizeRecord(body);
      if (saved) { setRecord(saved); setSource("desk"); }
      return true;
    } catch {
      setError("Serveur d’accueil injoignable : rien n’a été enregistré.");
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { record, source, saving, error, save };
}
