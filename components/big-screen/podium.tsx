"use client";

import { useEffect, useState } from "react";
import { LayoutList, Play, Trophy, Zap } from "lucide-react";
import { Confetti } from "./confetti";
import type { BoardRow } from "./race-simulation";
import type { RaceSound } from "./race-sound";
import { Lockup, initials } from "./lockup";
import { DriverAvatar } from "./driver-avatar";
import { SouvenirQr } from "./souvenir-qr";

// Reveal order: 3rd, then 2nd, then the winner. Each place raises its pedestal, then drops its card.
const TIMELINE = [
  { at: 450, fx: "drum" },   // 1: 3rd pedestal
  { at: 1250 },              // 2: 3rd card
  { at: 2150, fx: "drum" },  // 3: 2nd pedestal
  { at: 2950 },              // 4: 2nd card
  { at: 3950, fx: "drum" },  // 5: 1st pedestal
  { at: 5100, fx: "fanfare" }, // 6: winner + confetti
  { at: 6600 },              // 7: rest of the field + actions
] as const;

const PLACES = [
  { index: 1, place: 2, label: "2E", pedestal: 3, card: 4 },
  { index: 0, place: 1, label: "1ER", pedestal: 5, card: 6 },
  { index: 2, place: 3, label: "3E", pedestal: 1, card: 2 },
];

type PodiumProps = {
  rows: BoardRow[];
  subtitle: string;
  sound: RaceSound;
  souvenirUrl?: string | null; // player souvenir link, shown as a QR code once the winner is revealed
  onBack: () => void;
  onReplay: () => void;
};

export function Podium({ rows, subtitle, sound, souvenirUrl, onBack, onReplay }: PodiumProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const ids = TIMELINE.map((beat, i) =>
      window.setTimeout(() => {
        setStep(i + 1);
        if ("fx" in beat) sound[beat.fx]();
      }, beat.at),
    );
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [sound]);

  return (
    <section className="bs-podium" aria-label="Podium">
      <div className="bs-spot bs-spot--l" aria-hidden="true" />
      <div className="bs-spot bs-spot--r" aria-hidden="true" />

      <header className="bs-podium-head">
        <Lockup className="bs-podium-lockup" />
        <div>
          <span className="bs-kicker">{subtitle}</span>
          <h1>PODIUM</h1>
        </div>
      </header>

      <div className={"bs-gg" + (step >= 6 ? " is-in" : "")} aria-hidden="true">GOOD GAME</div>

      <div className="bs-stage">
        {PLACES.map(({ index, place, label, pedestal, card }) => {
          const row = rows[index];
          if (!row) return <div key={place} />;
          const primary = place === 1 && row.total !== "—" ? { k: "TEMPS", v: row.total } : place === 1 ? { k: "TOURS", v: String(row.laps) } : { k: "ÉCART", v: row.gap };
          return (
            <div key={place} className={`bs-place bs-place--${place}` + (step >= pedestal ? " is-up" : "") + (step >= card ? " is-revealed" : "")}>
              <div className="bs-place-card">
                {place === 1 && <Trophy className="bs-trophy" aria-hidden="true" />}
                <i className="bs-place-avatar">
                  {row.pilot ? <DriverAvatar pilot={row.pilot} seed={row.name} size="82%" /> : initials(row.name)}
                </i>
                {place === 1 && <span className="bs-gg-stamp">GOOD GAME!</span>}
                <b>{row.name}</b>
                <small>KART {row.kart}</small>
                <div className="bs-place-stats">
                  <span><em>{primary.k}</em>{primary.v}</span>
                  <span className={row.fastest ? "is-fastest" : undefined}>
                    <em>{row.fastest ? <><Zap aria-hidden="true" /> MEILLEUR TOUR</> : "MEILLEUR"}</em>{row.best}
                  </span>
                </div>
              </div>
              <div className="bs-pedestal-wrap">
                <div className="bs-pedestal">
                  <span>{place}</span>
                  <small>{label}</small>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bs-floor" aria-hidden="true"><div className="bs-rolling-wheel" /></div>

      <div className={"bs-field" + (step >= 7 ? " is-in" : "")}>
        {rows.slice(3).map((row) => (
          <span key={row.id}><b>P{row.rank}</b>{row.name}<em>{row.gap}</em></span>
        ))}
      </div>

      <Confetti active={step >= 6} />

      {souvenirUrl && <SouvenirQr url={souvenirUrl} className={"bs-podium-qr" + (step >= 6 ? " is-in" : "")} />}

      <div className={"bs-podium-actions" + (step >= 7 ? " is-in" : "")}>
        <button type="button" className="bs-btn" onClick={onBack}><LayoutList /> Classement</button>
        <button type="button" className="bs-btn bs-btn--primary" onClick={onReplay}><Play /> Nouvelle simulation</button>
      </div>
    </section>
  );
}
