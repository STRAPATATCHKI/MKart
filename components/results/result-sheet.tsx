"use client";

// Dashboard panel for one finished race: podium, full classification, the player souvenir QR
// code and the actions around it (copy / open the player page, show it on the big screen).
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, MonitorPlay, Trophy, Zap } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { QrCode } from "@/components/qr-code";
import { fmtLap } from "@/components/big-screen/race-simulation";
import type { HistorySession } from "@/hooks/use-history";
import { souvenirFromHistory, souvenirGap, souvenirUrl, type SouvenirDriver } from "@/lib/race-souvenir";
import { showResultOnBigScreen } from "@/lib/screen-channel";

export function ResultSheet({ result, onClose }: { result: HistorySession | null; onClose: () => void }) {
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const race = result ? souvenirFromHistory(result) : null;

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    void souvenirUrl(souvenirFromHistory(result)).then((url) => {
      if (!cancelled) setLink({ id: result.id, url });
    });
    return () => {
      cancelled = true;
    };
  }, [result]);

  const url = link && result && link.id === result.id ? link.url : null;
  const winner = race?.drivers[0] ?? null;
  const fastest = race?.drivers.reduce<SouvenirDriver | null>((best, d) => (d.bestLapMs != null && (best?.bestLapMs == null || d.bestLapMs < best.bestLapMs) ? d : best), null) ?? null;
  const when = result ? new Date(result.archivedAt).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <Sheet open={Boolean(result)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="booking-sheet result-sheet">
        {result && race && winner && (
          <>
            <SheetHeader>
              <SheetDescription>RÉSULTATS · {when.toUpperCase()}</SheetDescription>
              <SheetTitle>{result.megakart?.name || `Course ${result.id}`}</SheetTitle>
            </SheetHeader>
            <div className="sheet-body result-sheet-body">
              <div className="result-souvenir">
                <div className="result-qr">{url ? <QrCode value={url} label={`QR code du souvenir ${result.id}`} /> : <span>Génération…</span>}</div>
                <div className="result-souvenir-copy">
                  <span className="panel-kicker">SOUVENIR JOUEUR</span>
                  <strong>Scannez à la fin de la course</strong>
                  <p>Chaque pilote garde le classement complet sur son téléphone. Rien n’est stocké en ligne : le résultat est dans le lien.</p>
                  <div className="result-actions">
                    <button type="button" className="secondary-button" onClick={copy} disabled={!url}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copié" : "Copier le lien"}</button>
                    <a className={"secondary-button" + (url ? "" : " is-disabled")} href={url ?? undefined} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Ouvrir</a>
                  </div>
                </div>
              </div>

              <button type="button" className="primary-button full" onClick={() => showResultOnBigScreen(race)}>
                <MonitorPlay size={15} /> Afficher le podium sur l’écran géant
              </button>

              <ol className="result-list">
                {race.drivers.map((d, i) => (
                  <li key={`${d.kart}-${i}`} className={i < 3 ? `is-p${i + 1}` : ""}>
                    <b>{String(i + 1).padStart(2, "0")}</b>
                    <span><strong>{d.name}</strong><small>Kart {d.kart} · {d.laps} tours</small></span>
                    <span className="result-times">
                      <em className={d === fastest ? "lime" : ""}>{d === fastest && <Zap size={11} />}{fmtLap(d.bestLapMs)}</em>
                      <small>{i === 0 ? <><Trophy size={11} /> {d.totalTimeMs != null ? fmtLap(d.totalTimeMs) : "Vainqueur"}</> : souvenirGap(d, winner) ?? "—"}</small>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
