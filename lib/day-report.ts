// Rapport du jour, from the desk's own data: the races Timing Control saved, the reservations of
// the till, and the packs chosen on the phones. The rules themselves are in
// lib/day-report-rules.mjs, shared with the MegaKart API that serves the same report to the
// manager's app; this file narrows the desk's data to the day and gives the result its types.

import * as rules from "./day-report-rules.mjs";
import type { Reservation } from "@/hooks/use-queue";
import type { Offer } from "@/lib/catalog";
import type { TimingSavedRace } from "@/lib/timing-client";

export const RACE_MINUTES: number = rules.RACE_MINUTES;

/** What the report needs of a sign-up: the client's code and the pack chosen on the phone. */
export type ReportSignup = { queueCode?: string | null; code?: string | null; pack?: string | null; packLabel?: string | null; packTotalMad?: number | null };

export type Coverage =
  | "paid"            // a payment of the day covers this race
  | "extra"           // the pilot paid, but for fewer races than they did
  | "booked"          // booked that day, never cashed
  | "check"           // no sure match; a first name alone, or a close name - check by hand
  | "none";           // nobody of that name paid or booked that day

export type ReportEntry = {
  raceId: string;
  raceName: string;
  /** Race start, ms since 1970. */
  at: number;
  position: number | null;
  driver: string;
  kart: number | null;
  laps: number;
  bestLapMs: number | null;
  lapTimesMs: number[];
  coverage: Coverage;
  /** The reservation this race was counted against, if any. */
  reservation: string | null;
  /** Bookings whose names come close, for a hand check ("Hamza Bennani · MK-5478"). */
  suggestions: string[];
};

export type ReportRace = {
  raceId: string;
  name: string;
  /** ms since 1970. */
  startedAt: number | null;
  finishedAt: number | null;
  test: boolean;
  entries: ReportEntry[];
};

export type ReportPayment = {
  code: string;
  clientCode: string | null;
  status: Reservation["status"];
  paidAt: number | null;
  paidOnDay: boolean;
  amount: number | null;
  method: string;
  pack: string | null;
  /** The pack's price for this group, when the pack is known: an amount under it was not the full price. */
  packPrice: number | null;
  /** Races each pilot may do; null when nothing tells; Infinity for a subscription. */
  perPilot: number | null;
  /** Where perPilot comes from, in words: "Session 16 min", "d'après le montant"... */
  allowanceFrom: string;
  pilots: { name: string; races: number }[];
  racesDone: number;
  racesCovered: number;
  racesExtra: number;
};

export type DayReport = {
  day: string;
  races: ReportRace[];
  payments: ReportPayment[];
  /** Every race of a pilot that no payment of the day covers (tests excluded), in time order. */
  uncovered: ReportEntry[];
  /** Cashed that day, but none of its pilots is in any race of the day. */
  paidNoRace: ReportPayment[];
  totals: {
    races: number;
    tests: number;
    driverRaces: number;
    pilots: number;
    covered: number;
    extra: number;
    booked: number;
    check: number;
    none: number;
    revenue: number;
    /** The price of one race at the counter (Session 8 min), to put a figure on what is missing. */
    racePrice: number | null;
    missingDh: number | null;
    /** Payments under the price of their own pack, and by how much in all. */
    underpaid: number;
    underpaidDh: number;
  };
};

export const nameTokens = (name: string): string[] => rules.nameTokens(name);
export const sameName = (a: string, b: string): boolean => rules.sameName(a, b);
export const racesInOffer = (offer: Offer): number | null => rules.racesInOffer(offer);
export const cheapestRace = (offers: Offer[]): number | null => rules.cheapestRace(offers);
export const isTestRace = (name: string | null | undefined): boolean => rules.isTestRace(name);

// This PC's clock is the venue's, so local days are the venue's days.
const dayOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const PAID = new Set<Reservation["status"]>(["PAYEE", "EN_PISTE", "TERMINEE"]);

/** The races of one day and the till of that day, set against each other. */
export function buildDayReport({ day, races, reservations, signups = [], offers = [] }: {
  day: string;
  races: TimingSavedRace[];
  reservations: Reservation[];
  signups?: ReportSignup[];
  offers?: Offer[];
}): DayReport {
  const signupOf = new Map<string, ReportSignup>();
  for (const s of signups) if (s.queueCode) signupOf.set(s.queueCode, s);

  const dayRaces = races
    .filter((r) => {
      const t = r.startedAt ?? r.finishedAt ?? r.savedAt;
      return t != null && dayOf(t * 1000) === day;
    })
    .map((r) => ({
      raceId: r.raceId, name: r.name, startedAt: r.startedAt != null ? r.startedAt * 1000 : null,
      finishedAt: r.finishedAt != null ? r.finishedAt * 1000 : null,
      racers: r.racers.map((d) => ({ driver: d.driver, kart: d.kart ?? null, laps: d.laps ?? 0, bestLapMs: d.bestLapMs ?? null, lapTimesMs: d.lapTimesMs ?? [] })),
    }));

  // The day's till: cashed that day, or booked that day - never the bin or cancelled ones.
  const till = reservations
    .filter((r) => r.status !== "SUPPRIMEE" && r.status !== "ANNULEE")
    .map((r) => ({ r, paidOnDay: PAID.has(r.status) && !!r.paidAt && dayOf(Date.parse(r.paidAt)) === day }))
    .filter(({ r, paidOnDay }) => paidOnDay || dayOf(Date.parse(r.createdAt)) === day)
    .map(({ r, paidOnDay }) => {
      const signup = signupOf.get(r.code);
      return {
        code: r.code, clientCode: signup?.code ?? r.replayOf?.clientCode ?? null, status: r.status,
        paidAt: r.paidAt ? Date.parse(r.paidAt) : null, paidOnDay,
        amount: typeof r.paidAmount === "number" ? r.paidAmount : null,
        method: r.paidSplit ? `Espèces ${r.paidSplit.cash} + Carte ${r.paidSplit.card}` : r.paymentMethod,
        pilots: r.pilots.map((p) => ({ id: p.id, name: p.fullName })),
        packId: r.packOverride?.id ?? signup?.pack ?? null,
        packName: r.packOverride?.label ?? signup?.packLabel ?? null,
        packPrice: r.packOverride ? r.packOverride.total : signup?.packTotalMad ?? null,
      };
    });

  return rules.buildDayReport({ day, races: dayRaces, till, offers }) as DayReport;
}
