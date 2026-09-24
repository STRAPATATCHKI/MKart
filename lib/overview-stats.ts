// The numbers on Vue générale, computed from what the venue actually recorded.
//
// Money comes from the till: a reservation cashed at the desk records its method and - since
// the cashing panel asks for it - the amount collected. Reservations cashed before amounts
// were recorded fall back to their sign-up's pack total when there is one, and are counted as
// "montant inconnu" when there is not, rather than being guessed at. Nothing here invents a
// figure: an empty day reads zero, and an unknown amount is shown as unknown.

import type { QueueStatus, Reservation } from "@/hooks/use-queue";
import type { Signup } from "@/lib/bridge-client";
import type { TimingSavedRace } from "@/lib/timing-client";

/** Local calendar day, YYYY-MM-DD: a sale at 23:30 belongs to today, not to tomorrow in UTC. */
export function dayKey(when: string | number | Date): string {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type Money = { total: number; cash: number; card: number; unknown: number; estimated: number; count: number };

const emptyMoney = (): Money => ({ total: 0, cash: 0, card: 0, unknown: 0, estimated: 0, count: 0 });

/** What a paid reservation brought in, and how sure we are of it. */
export function amountOf(r: Reservation, packTotalByCode: Map<string, number>): { amount: number | null; estimated: boolean } {
  if (typeof r.paidAmount === "number" && Number.isFinite(r.paidAmount)) return { amount: r.paidAmount, estimated: false };
  // A pack corrected at the counter replaces what the client chose on the phone.
  if (r.packOverride?.total != null) return { amount: r.packOverride.total, estimated: true };
  const fromPack = packTotalByCode.get(r.code);
  if (fromPack != null) return { amount: fromPack, estimated: true };
  return { amount: null, estimated: false };
}

const PAID = new Set(["PAYEE", "EN_PISTE", "TERMINEE"]);

export function isPaid(r: Reservation): boolean {
  return PAID.has(r.status) && !!r.paidAt;
}

export function packTotals(signups: Signup[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of signups) if (s.queueCode && s.packTotalMad != null) map.set(s.queueCode, s.packTotalMad);
  return map;
}

/** Money taken on each of the given days, split by method. */
export function moneyByDay(reservations: Reservation[], signups: Signup[], days: string[]): Map<string, Money> {
  const totals = packTotals(signups);
  const out = new Map<string, Money>(days.map((d) => [d, emptyMoney()]));
  for (const r of reservations) {
    if (!isPaid(r)) continue;
    const m = out.get(dayKey(r.paidAt!));
    if (!m) continue;
    m.count += 1;
    const { amount, estimated } = amountOf(r, totals);
    if (amount == null) { m.unknown += 1; continue; }
    if (estimated) m.estimated += 1;
    m.total += amount;
    if (r.paymentMethod === "Espèces") m.cash += amount; else m.card += amount;
  }
  return out;
}

/** The last n days, oldest first, ending today. */
export function lastDays(n: number, today = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push(dayKey(d));
  }
  return out;
}

/** From the first of this month to today. */
export function monthDays(today = new Date()): string[] {
  return lastDays(today.getDate(), today);
}

export function dayLabel(key: string, span: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return span <= 7
    ? date.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "")
    : String(d);
}

export type TodaySummary = {
  money: Money;
  yesterday: Money;
  paidReservations: number;
  paidPilots: number;
  racesToday: number;
  pilotsToday: number;
  pilotsYesterday: number;
  signupsToday: number;
  /** Reservations of today still to be cashed, and what their packs say they will bring. */
  waiting: number;
  waitingExpected: number;
};

export function todaySummary(reservations: Reservation[], signups: Signup[], races: TimingSavedRace[], now = new Date()): TodaySummary {
  const [yesterdayKey, todayKey] = lastDays(2, now);
  const money = moneyByDay(reservations, signups, [yesterdayKey, todayKey]);
  const paidToday = reservations.filter((r) => isPaid(r) && dayKey(r.paidAt!) === todayKey);
  const createdToday = reservations.filter((r) => dayKey(r.createdAt) === todayKey && r.status !== "ANNULEE" && r.status !== "SUPPRIMEE");
  const racesToday = races.filter((r) => {
    const t = r.finishedAt ?? r.startedAt ?? r.savedAt;
    return t != null && dayKey(t * 1000) === todayKey && !/^\s*\[sim\]/i.test(r.name ?? "");
  });
  const pilots = pilotsByDay(reservations, [yesterdayKey, todayKey]);
  const totals = packTotals(signups);
  const waiting = createdToday.filter((r) => WAITING.has(r.status));
  return {
    money: money.get(todayKey) ?? emptyMoney(),
    yesterday: money.get(yesterdayKey) ?? emptyMoney(),
    paidReservations: paidToday.length,
    paidPilots: paidToday.reduce((n, r) => n + (r.pilots?.length ?? 0), 0),
    racesToday: racesToday.length,
    pilotsToday: pilots[1],
    pilotsYesterday: pilots[0],
    signupsToday: signups.filter((s) => dayKey(s.createdAt) === todayKey).length,
    waiting: waiting.length,
    waitingExpected: waiting.reduce((n, r) => n + (amountOf(r, totals).amount ?? 0), 0),
  };
}

const WAITING = new Set<QueueStatus>(["EN_ATTENTE", "AU_GUICHET"]);

/** Pilots booked on each day (the day the reservation was made), cancellations left out. */
export function pilotsByDay(reservations: Reservation[], days: string[]): number[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const r of reservations) {
    if (r.status === "ANNULEE" || r.status === "SUPPRIMEE") continue;
    const i = index.get(dayKey(r.createdAt));
    if (i != null) out[i] += r.pilots?.length ?? 0;
  }
  return out;
}

export type RevenueDay = Money & { key: string; label: string };

/** One bar per day for the revenue chart, oldest first. */
export function revenueSeries(reservations: Reservation[], signups: Signup[], days: string[]): RevenueDay[] {
  const money = moneyByDay(reservations, signups, days);
  return days.map((key) => ({ key, label: dayLabel(key, days.length), ...(money.get(key) ?? emptyMoney()) }));
}

/** The top of a chart axis: the next round figure at or above v (1, 2, 2.5 or 5 times a power of ten). */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v - 1e-9) return m * p;
  return 10 * p;
}

/** 15000 -> "15k", 2500 -> "2,5k", 800 -> "800". */
export function shortDh(v: number): string {
  if (Math.abs(v) < 1000) return String(Math.round(v));
  const k = v / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1).replace(".", ",")}k`;
}

export type BookingStatus = "À encaisser" | "Confirmée" | "En piste" | "Terminée" | "Absent";

export type Booking = {
  code: string;
  time: string;
  createdAt: string;
  customer: string;
  initials: string;
  phone: string | null;
  pack: string;
  pilots: string[];
  /** Collected when paid; the pack's price while still waiting; null when neither is known. */
  amount: number | null;
  estimated: boolean;
  status: BookingStatus;
  source: string;
  payment: string | null;
  paidBy: string | null;
  note: string | null;
};

const BOOKING_STATUS: Partial<Record<QueueStatus, BookingStatus>> = {
  EN_ATTENTE: "À encaisser", AU_GUICHET: "À encaisser", PAYEE: "Confirmée",
  EN_PISTE: "En piste", TERMINEE: "Terminée", ABSENT: "Absent",
};
// Who needs the operator first: people still at the counter, then the karts on track.
const BOOKING_ORDER: BookingStatus[] = ["À encaisser", "En piste", "Confirmée", "Terminée", "Absent"];

/** Today's reservations - made today, or cashed today - as rows for the table. */
export function todayBookings(reservations: Reservation[], signups: Signup[], now = new Date()): Booking[] {
  const today = dayKey(now);
  const bySignup = new Map<string, Signup>();
  for (const s of signups) if (s.queueCode) bySignup.set(s.queueCode, s);
  const totals = packTotals(signups);
  const rows: Booking[] = [];
  for (const r of reservations) {
    const status = BOOKING_STATUS[r.status];
    if (!status) continue;
    if (dayKey(r.createdAt) !== today && !(r.paidAt && dayKey(r.paidAt) === today)) continue;
    const { amount, estimated } = amountOf(r, totals);
    const name = (r.contactName || "").trim() || "Client";
    const d = new Date(r.createdAt);
    rows.push({
      code: r.code,
      time: Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      createdAt: r.createdAt,
      customer: name,
      initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join(""),
      phone: r.phone?.trim() || null,
      pack: r.packOverride?.label || bySignup.get(r.code)?.packLabel || r.raceType || "—",
      pilots: (r.pilots ?? []).map((p) => p.fullName).filter(Boolean),
      amount,
      estimated: estimated || !isPaid(r),
      status,
      source: r.channel === "enligne" ? "Inscription QR" : "Guichet",
      payment: isPaid(r) ? r.paymentMethod : null,
      paidBy: isPaid(r) ? r.paidBy : null,
      note: r.note,
    });
  }
  return rows.sort((a, b) =>
    BOOKING_ORDER.indexOf(a.status) - BOOKING_ORDER.indexOf(b.status) || a.createdAt.localeCompare(b.createdAt));
}

/** "+12 %" against yesterday, or "—" when there is nothing to compare with. */
export function changeVs(now: number, before: number): string {
  if (!(before > 0)) return now > 0 ? "NEW" : "—";
  const pct = ((now - before) / before) * 100;
  return `${pct >= 0 ? "+" : ""}${Math.round(pct)} %`;
}

export type PackSale = { label: string; count: number; amount: number };

/** What sold in the period, by pack, from paid reservations joined to their sign-up. */
export function packSales(reservations: Reservation[], signups: Signup[], days: string[]): PackSale[] {
  const allowed = new Set(days);
  const bySignup = new Map<string, Signup>();
  for (const s of signups) if (s.queueCode) bySignup.set(s.queueCode, s);
  const totals = packTotals(signups);
  const out = new Map<string, PackSale>();
  for (const r of reservations) {
    if (!isPaid(r) || !allowed.has(dayKey(r.paidAt!))) continue;
    const label = r.packOverride?.label || bySignup.get(r.code)?.packLabel || "Sans formule (guichet)";
    const row = out.get(label) ?? { label, count: 0, amount: 0 };
    row.count += 1;
    row.amount += amountOf(r, totals).amount ?? 0;
    out.set(label, row);
  }
  return [...out.values()].sort((a, b) => b.count - a.count || b.amount - a.amount);
}

export type BestLap = { driver: string; kart: number; bestLapMs: number; raceName: string };

/** Today's fastest laps across every saved race, one line per driver, fastest first. */
export function bestLapsToday(races: TimingSavedRace[], now = new Date(), limit = 8): BestLap[] {
  const today = dayKey(now);
  const best = new Map<string, BestLap>();
  for (const race of races) {
    const t = race.finishedAt ?? race.startedAt ?? race.savedAt;
    if (t == null || dayKey(t * 1000) !== today || /^\s*\[sim\]/i.test(race.name ?? "")) continue;
    for (const r of race.racers) {
      if (r.bestLapMs == null || !(r.bestLapMs > 0)) continue;
      const key = r.driver.trim().toLowerCase();
      const prev = best.get(key);
      if (!prev || r.bestLapMs < prev.bestLapMs) {
        best.set(key, { driver: r.driver, kart: r.kart, bestLapMs: r.bestLapMs, raceName: race.name ?? race.raceId });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.bestLapMs - b.bestLapMs).slice(0, limit);
}
