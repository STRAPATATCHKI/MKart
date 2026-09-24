"use client";

// RECORDS — lower down the souvenir page, after the classification: the pilot's best lap next
// to the best of their race, the best of the day at the venue and the all-time track record,
// as bars. Something to come back for. Deliberately NOT in the story image (story-card.ts):
// that is for showing friends the result, this is for the pilot who scrolls.
//
// The day's best and the record travel in the link, as they stood when the race ended. Links
// made before that fall back to the venue's record alone.

import { CalendarDays, Flag, Trophy, User } from "lucide-react";
import type { RaceSouvenir, SouvenirDriver } from "@/lib/race-souvenir";
import { DEFAULT_RECORD } from "@/lib/track-record";

type Tone = "record" | "day" | "race" | "me";
type Bar = { key: Tone; label: string; who: string | null; ms: number };

const ICONS = { record: Trophy, day: CalendarDays, race: Flag, me: User } as const;

const signed = (ms: number) => `${ms < 0 ? "−" : "+"}${(Math.abs(ms) / 1000).toFixed(3)}`;

export function RecordBars({ race, me, fastest, fmtLap }: {
  race: RaceSouvenir;
  me: SouvenirDriver | null;
  fastest: SouvenirDriver | null;
  fmtLap: (ms: number | null) => string;
}) {
  if (race.kind === "simulation") return null;
  const rec = race.records ?? null;
  const recordMs = rec?.recordMs ?? DEFAULT_RECORD.lapMs;
  const recordBy = rec ? rec.recordBy : DEFAULT_RECORD.driver;

  // Most specific first, so a lap that is at once "mine", "the race's" and "the day's" is shown
  // once, under the label that matters most to the person reading.
  const candidates: Bar[] = [];
  if (me?.bestLapMs != null) candidates.push({ key: "me", label: "Ton meilleur tour", who: me.name, ms: me.bestLapMs });
  if (fastest?.bestLapMs != null) candidates.push({ key: "race", label: "Meilleur de ta course", who: fastest.name, ms: fastest.bestLapMs });
  if (rec?.dayBestMs != null) candidates.push({ key: "day", label: "Meilleur tour du jour", who: rec.dayBestBy, ms: rec.dayBestMs });
  const bars: Bar[] = [{ key: "record", label: "Record de la piste", who: recordBy, ms: recordMs }];
  for (const c of candidates) {
    if (!bars.some((b) => b.ms === c.ms && (b.who ?? "") === (c.who ?? ""))) bars.push(c);
  }
  bars.sort((a, b) => a.ms - b.ms);

  // Fastest bar full, slowest at a third: the differences are seconds on a 25 s lap, and bars
  // drawn to scale would all look the same length.
  const lo = bars[0].ms;
  const hi = bars[bars.length - 1].ms;
  const width = (ms: number) => (hi === lo ? 100 : 100 - ((ms - lo) / (hi - lo)) * 64);

  const myGap = me?.bestLapMs != null ? me.bestLapMs - recordMs : null;
  const iAmDayBest = me?.bestLapMs != null && rec?.dayBestMs != null && me.bestLapMs <= rec.dayBestMs;
  const message = me == null || myGap == null
    ? "Touchez votre nom plus haut pour vous comparer au record."
    : myGap < 0 ? "Nouveau record de la piste ! Bravo, pilote."
    : iAmDayBest ? `Meilleur tour du jour ! Plus que ${(myGap / 1000).toFixed(3)} s pour le record.`
    : `Il te manque ${(myGap / 1000).toFixed(3)} s pour égaler le record. Reviens le battre !`;

  return (
    <section className="sv-records" aria-label="Records">
      <h2>Records</h2>
      <ul>
        {bars.map((b) => {
          const Icon = ICONS[b.key];
          return (
            <li key={b.key} className={`sv-rec sv-rec--${b.key}`}>
              <div className="sv-rec-head">
                <span><Icon aria-hidden="true" /> {b.label}</span>
                <b>{fmtLap(b.ms)}</b>
              </div>
              <div className="sv-rec-track" aria-hidden="true"><i style={{ width: `${width(b.ms)}%` }} /></div>
              <small>
                {b.who ?? (b.key === "record" ? "Record de MegaKart Fès" : "")}
                {b.key !== "record" ? ` · ${signed(b.ms - recordMs)} du record` : ""}
              </small>
            </li>
          );
        })}
      </ul>
      <p className={"sv-records-msg" + (myGap != null && myGap < 0 ? " is-record" : "")}>{message}</p>
    </section>
  );
}
