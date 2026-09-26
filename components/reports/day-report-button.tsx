"use client";

// "Rapport du jour (PDF)" in Courses terminées: pick a day, and every race of it comes out on
// paper with its pilots and times, set against the day's payments. Everything is read fresh at
// the click - the races from Timing Control, the till from the desk, the packs chosen on the
// phones from the bridge - so the report is never older than the moment it was asked for.

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { openReportWindow, showDayReport, showReportError } from "@/components/reports/day-report-html";
import { useCatalog } from "@/hooks/use-catalog";
import type { Reservation } from "@/hooks/use-queue";
import type { RaceSummary } from "@/components/timing/race-summaries";
import { fetchSignups } from "@/lib/bridge-client";
import { buildDayReport, type ReportSignup } from "@/lib/day-report";
import { timing, type TimingSavedRace } from "@/lib/timing-client";

const dayOf = (seconds: number) => {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const label = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });

export function DayReportButton({ races }: { races: RaceSummary[] }) {
  const { catalog } = useCatalog();
  const days = useMemo(() => {
    const set = new Set<string>();
    for (const r of races) if (r.endedAt != null) set.add(dayOf(r.endedAt));
    return [...set].sort().reverse();
  }, [races]);
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && days.includes(picked) ? picked : days[0] ?? null;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const make = async () => {
    if (!day) return;
    const win = openReportWindow(day);
    if (!win) { setNote("Le navigateur a bloqué la fenêtre : autorisez les pop-up pour ce site, puis réessayez."); return; }
    setBusy(true);
    setNote(null);
    try {
      // The day's races with their laps, a few at a time: Timing Control may be timing a race.
      const list = (await timing.races()).filter((r) => {
        const t = r.startedAt ?? r.finishedAt ?? r.savedAt;
        return t != null && dayOf(t) === day;
      });
      const full: TimingSavedRace[] = [];
      for (let i = 0; i < list.length; i += 4) {
        const batch = await Promise.all(list.slice(i, i + 4).map((r) => timing.race(r.raceId).catch(() => null)));
        for (const race of batch) if (race) full.push(race);
      }
      const queue = await fetch("/api/queue", { cache: "no-store" });
      if (!queue.ok) throw new Error("La caisse (serveur d’accueil) ne répond pas : impossible de comparer aux paiements.");
      const reservations = ((await queue.json()) as { reservations?: Reservation[] }).reservations ?? [];
      // The packs chosen on the phones; without the bridge the report still works, from the amounts.
      let signups: ReportSignup[] = [];
      try { signups = await fetchSignups(); } catch { setNote("Inscriptions injoignables : formules déduites des montants payés."); }
      showDayReport(win, buildDayReport({ day, races: full, reservations, signups, offers: catalog.offers }));
    } catch (e) {
      const message = e instanceof Error && e.message !== "MegaKart Timing Control ne répond pas" ? e.message
        : "MegaKart Timing Control ne répond pas : ouvrez-le sur le PC du chrono, puis réessayez.";
      showReportError(win, message);
      setNote(message);
    } finally {
      setBusy(false);
    }
  };

  if (!days.length) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <select value={day ?? ""} onChange={(e) => setPicked(e.target.value)} aria-label="Jour du rapport"
        style={{ height: 32, padding: "0 8px", borderRadius: 7, border: "1px solid #2a3440", background: "#0f151b", color: "#e6ece2", font: "inherit", fontSize: 12 }}>
        {days.map((d) => <option key={d} value={d}>{label(d)}</option>)}
      </select>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void make()}
        title="Toutes les courses du jour, pilotes et temps, comparées aux paiements — à enregistrer en PDF">
        <FileText size={14} /> {busy ? "Préparation…" : "Rapport du jour (PDF)"}
      </button>
      {note ? <small style={{ color: "#f5b83d", maxWidth: 360 }}>{note}</small> : null}
    </span>
  );
}
