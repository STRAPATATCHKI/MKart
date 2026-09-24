"use client";

// Player-facing race souvenir, opened on a phone by scanning the QR code shown at the end of a
// race. Everything it shows comes from the link itself (see lib/race-souvenir.ts).
import { useEffect, useMemo, useState } from "react";
import { Check, Flag, ImageDown, Share2, Timer, Trophy, UsersRound, Zap } from "lucide-react";
import { renderStoryCard, shareStory } from "./story-card";
import { RecordBars } from "./record-bars";
import { DriverAvatar } from "@/components/big-screen/driver-avatar";
import { Lockup } from "@/components/big-screen/lockup";
import { fmtLap } from "@/components/big-screen/race-simulation";
import { decodeSouvenir, souvenirGap, type RaceSouvenir } from "@/lib/race-souvenir";

const FONT_HREF = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,800;1,900&display=swap";
const PODIUM = [
  { index: 1, place: 2, label: "2e" },
  { index: 0, place: 1, label: "1er" },
  { index: 2, place: 3, label: "3e" },
];

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; race: RaceSouvenir };

const readPick = (id: string) => {
  try {
    const value = window.localStorage.getItem(`mk-souvenir-pick:${id}`);
    return value == null ? null : Number(value);
  } catch {
    return null;
  }
};

const savePick = (id: string, index: number) => {
  try {
    window.localStorage.setItem(`mk-souvenir-pick:${id}`, String(index));
  } catch {
    /* private mode: the highlight just won't be remembered */
  }
};

export function SouvenirPage({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [pick, setPick] = useState<number | null>(null);
  const [shared, setShared] = useState<"idle" | "copied">("idle");
  const [story, setStory] = useState<"idle" | "drawing" | "downloaded" | "failed">("idle");

  useEffect(() => {
    let cancelled = false;
    decodeSouvenir(token)
      .then((race) => {
        if (cancelled) return;
        setState({ status: "ready", race });
        setPick(readPick(race.id));
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "Lien de souvenir invalide." });
      });
    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      document.head.appendChild(link);
    }
    return () => {
      cancelled = true;
    };
  }, [token]);

  const race = state.status === "ready" ? state.race : null;
  const stats = useMemo(() => {
    if (!race || race.drivers.length === 0) return null;
    const fastest = race.drivers.reduce((best, d) => (d.bestLapMs != null && (best == null || d.bestLapMs < (best.bestLapMs ?? Infinity)) ? d : best), null as RaceSouvenir["drivers"][number] | null);
    return { winner: race.drivers[0], fastest, laps: race.drivers[0].laps };
  }, [race]);

  if (state.status === "loading") {
    return <main className="sv sv-center"><div className="sv-spinner" aria-hidden="true"><i /></div><p>Chargement de votre souvenir…</p></main>;
  }
  if (state.status === "error" || !race || !stats) {
    return (
      <main className="sv sv-center">
        <Lockup className="sv-error-lockup" />
        <h1 className="sv-error-title">Souvenir introuvable</h1>
        <p>{state.status === "error" ? state.message : "Ce lien ne contient aucun résultat."} Scannez à nouveau le QR code affiché à la fin de la course.</p>
      </main>
    );
  }

  const finishedAt = new Date(race.finishedAt);
  const dateLabel = finishedAt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeLabel = finishedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const me = pick != null ? race.drivers[pick] ?? null : null;

  const choose = (index: number) => {
    setPick(index);
    savePick(race.id, index);
  };

  const share = async () => {
    const text = me
      ? `P${pick! + 1} sur ${race.drivers.length} chez ${race.track} · meilleur tour ${fmtLap(me.bestLapMs)} 🏁`
      : `Résultats de la course ${race.track} du ${finishedAt.toLocaleDateString("fr-FR")} 🏁`;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Souvenir ${race.track}`, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setShared("copied");
      window.setTimeout(() => setShared("idle"), 2400);
    } catch {
      /* share sheet dismissed */
    }
  };

  // The story: an image, because that is the only thing that goes into a story. Drawn on the
  // phone, handed to the share sheet as a file - Instagram, WhatsApp and the camera roll all
  // take it from there. Every story is a customer showing their friends where they raced.
  const shareAsStory = async () => {
    if (story === "drawing") return;
    setStory("drawing");
    try {
      const blob = await renderStoryCard({ race, pick, fmtLap });
      if (!blob) { setStory("failed"); return; }
      const outcome = await shareStory(blob, `megakart-${race.id}.png`);
      setStory(outcome === "downloaded" ? "downloaded" : outcome === "failed" ? "failed" : "idle");
    } catch {
      setStory("failed");
    }
    window.setTimeout(() => setStory("idle"), 3000);
  };

  return (
    <main className="sv">
      <header className="sv-head">
        <Lockup className="sv-lockup" spin="3.2s" />
        <div>
          <span className="sv-kicker">Souvenir officiel</span>
          <strong>{race.track}</strong>
        </div>
      </header>

      <section className="sv-hero" aria-label="Course">
        <span className="sv-date">{dateLabel} · {timeLabel}</span>
        <h1>{race.kind === "simulation" ? "Course simulée" : "Résultats de course"}</h1>
        <ul className="sv-facts">
          <li><UsersRound aria-hidden="true" /> {race.drivers.length} pilote{race.drivers.length > 1 ? "s" : ""}</li>
          <li><Flag aria-hidden="true" /> {stats.laps} tour{stats.laps > 1 ? "s" : ""}</li>
          {stats.fastest && <li><Zap aria-hidden="true" /> {fmtLap(stats.fastest.bestLapMs)}</li>}
        </ul>
      </section>

      <section className="sv-podium" aria-label="Podium">
        {PODIUM.map(({ index, place, label }) => {
          const driver = race.drivers[index];
          if (!driver) return <div key={place} />;
          return (
            <button type="button" key={place} className={`sv-place sv-place--${place}` + (pick === index ? " is-me" : "")} onClick={() => choose(index)}>
              {place === 1 && <Trophy className="sv-trophy" aria-hidden="true" />}
              <span className="sv-place-kart"><DriverAvatar pilot={driver.pilot} seed={driver.name} /></span>
              <b>{driver.name}</b>
              <small>{place === 1 ? (driver.totalTimeMs != null ? fmtLap(driver.totalTimeMs) : `${driver.laps} tours`) : souvenirGap(driver, stats.winner) ?? "—"}</small>
              <span className="sv-block"><em>{place}</em><i>{label}</i></span>
            </button>
          );
        })}
      </section>

      {me ? (
        <section className="sv-me" aria-live="polite">
          <div className="sv-me-rank"><small>Ta place</small><b>P{pick! + 1}</b><span>sur {race.drivers.length}</span></div>
          <div className="sv-me-body">
            <strong>{me.name}</strong>
            <dl>
              <div><dt>Meilleur</dt><dd className={stats.fastest === me ? "is-fastest" : ""}>{fmtLap(me.bestLapMs)}</dd></div>
              <div><dt>Tours</dt><dd>{me.laps}</dd></div>
              <div><dt>Écart</dt><dd>{souvenirGap(me, stats.winner) ?? "Vainqueur"}</dd></div>
            </dl>
            {stats.fastest === me && <p className="sv-badge"><Zap aria-hidden="true" /> Meilleur tour de la course</p>}
          </div>
          <button type="button" className="sv-share sv-share--story" onClick={shareAsStory} disabled={story === "drawing"}>
            {story === "drawing" ? <><Timer aria-hidden="true" /> Préparation de l’image…</>
              : story === "downloaded" ? <><Check aria-hidden="true" /> Image enregistrée</>
              : story === "failed" ? <>Réessayer</>
              : <><ImageDown aria-hidden="true" /> Partager en story</>}
          </button>
          <button type="button" className="sv-share sv-share--ghost" onClick={share}>
            {shared === "copied" ? <><Check aria-hidden="true" /> Lien copié</> : <><Share2 aria-hidden="true" /> Envoyer le lien</>}
          </button>
        </section>
      ) : (
        <p className="sv-hint"><Timer aria-hidden="true" /> Touchez votre nom pour garder votre résultat en avant.</p>
      )}

      <section className="sv-table" aria-label="Classement complet">
        <h2>Classement</h2>
        <ol>
          {race.drivers.map((driver, index) => (
            <li key={`${driver.kart}-${index}`}>
              <button type="button" className={pick === index ? "is-me" : ""} onClick={() => choose(index)} aria-pressed={pick === index}>
                <span className="sv-pos">{index + 1}</span>
                <span className="sv-kart"><DriverAvatar pilot={driver.pilot} seed={driver.name} /></span>
                <span className="sv-name"><b>{driver.name}</b><small>Kart {driver.kart} · {driver.laps} tours</small></span>
                <span className="sv-times">
                  <b className={stats.fastest === driver ? "is-fastest" : ""}>{stats.fastest === driver && <Zap aria-hidden="true" />}{fmtLap(driver.bestLapMs)}</b>
                  <small>{souvenirGap(driver, stats.winner) ?? "Vainqueur"}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      {!me && (
        <div className="sv-share-row">
          <button type="button" className="sv-share sv-share--story" onClick={shareAsStory} disabled={story === "drawing"}>
            {story === "drawing" ? <><Timer aria-hidden="true" /> Préparation…</>
              : story === "downloaded" ? <><Check aria-hidden="true" /> Image enregistrée</>
              : <><ImageDown aria-hidden="true" /> Partager en story</>}
          </button>
          <button type="button" className="sv-share sv-share--ghost" onClick={share}>
            {shared === "copied" ? <><Check aria-hidden="true" /> Lien copié</> : <><Share2 aria-hidden="true" /> Envoyer le lien</>}
          </button>
        </div>
      )}

      {/* On the page only, never in the story image: scroll down to see what to chase. */}
      <RecordBars race={race} me={me} fastest={stats.fastest} fmtLap={fmtLap} />

      <footer className="sv-foot">
        <span>Chronométrage officiel {race.track}</span>
        <span>Réf. {race.id}</span>
      </footer>
    </main>
  );
}
