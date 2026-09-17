// Visitor reservations — the booking a customer makes on their own phone, before they
// reach the desk. Mirrors lib/megakart-session.ts: same id/store shape, localStorage for
// now, D1 via Drizzle later. Nothing here touches Apex or the timing bridge's read-only tap.
//
// A reservation is NEVER charged online. The visitor only declares how they intend to pay;
// the money is taken at the caisse, and a staff member validates it there. That is why the
// lifecycle starts at "en attente de paiement" and only staff can move it to "payée".

export type KartColor = "blue" | "black" | "green";

// Only the colours we actually have artwork for. A 4th (white) kart is expected — adding it
// here and dropping the PNG in public/karts/ is the whole change, no layout work.
export const KART_COLORS: { value: KartColor; label: string; image: string; swatch: string }[] = [
  { value: "blue", label: "Bleu", image: "/karts/kart-blue.png", swatch: "#2f6fd0" },
  { value: "black", label: "Noir", image: "/karts/kart-black.png", swatch: "#4a4f55" },
  { value: "green", label: "Vert", image: "/karts/kart-green.png", swatch: "#6ec83a" },
];

// The bookable race types. Only Chrono is open today; the rest are announced, not hidden,
// so visitors can see what is coming. Values match SESSION_TYPE_LABELS in megakart-session.ts.
export type RaceType = "practice" | "race" | "game" | "merge";
export const RACE_TYPES: { value: RaceType; label: string; tagline: string; available: boolean }[] = [
  { value: "practice", label: "Chrono", tagline: "Course au chronomètre · 8 min", available: true },
  { value: "race", label: "Course", tagline: "Départ groupé et classement", available: false },
  { value: "game", label: "Pay & Go", tagline: "Roulez, payez au tour", available: false },
  { value: "merge", label: "Cumul", tagline: "Meilleurs temps cumulés", available: false },
];

export type PaymentMethod = "Carte bancaire" | "Espèces";
export const PAYMENT_METHODS: { value: PaymentMethod; label: string; hint: string }[] = [
  { value: "Espèces", label: "Espèces", hint: "Réglez en liquide à la caisse" },
  { value: "Carte bancaire", label: "Carte bancaire", hint: "TPE disponible à la caisse" },
];

export type ReservationStatus = "EN_ATTENTE" | "PAYEE" | "ANNULEE";
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  EN_ATTENTE: "En attente de paiement",
  PAYEE: "Payée",
  ANNULEE: "Annulée",
};

export interface ReservationPilot {
  id: string;
  fullName: string;
  kartColor: KartColor;
}

export interface Reservation {
  id: string;
  /** Short human code the visitor reads out at the desk, e.g. "MK-4821". */
  code: string;
  contactName: string;
  phone: string;
  email?: string;
  raceType: RaceType;
  pilots: ReservationPilot[];
  paymentMethod: PaymentMethod;
  status: ReservationStatus;
  createdAt: string;
  /** Set when a staff member validates the payment at the caisse. */
  paidAt?: string | null;
  paidBy?: string | null;
}

const KEY = "megakart-reservations-v1";

function rid(prefix = "RES"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/** 4 digits is enough to disambiguate a day's queue and is easy to read aloud at a noisy desk. */
function bookingCode(): string {
  return `MK-${Math.floor(1000 + Math.random() * 9000)}`;
}

function read(): Reservation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(list: Reservation[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode) — the caller still holds the value in memory */
  }
}

export function listReservations(): Reservation[] {
  return read().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface NewReservationInput {
  contactName: string;
  phone: string;
  email?: string;
  raceType: RaceType;
  pilots: { fullName: string; kartColor: KartColor }[];
  paymentMethod: PaymentMethod;
}

export function createReservation(input: NewReservationInput): Reservation {
  const reservation: Reservation = {
    id: rid(),
    code: bookingCode(),
    contactName: input.contactName.trim(),
    phone: normalizePhone(input.phone),
    email: input.email?.trim() || undefined,
    raceType: input.raceType,
    pilots: input.pilots.map((p) => ({
      id: rid("PIL"),
      fullName: p.fullName.trim(),
      kartColor: p.kartColor,
    })),
    paymentMethod: input.paymentMethod,
    status: "EN_ATTENTE",
    createdAt: new Date().toISOString(),
    paidAt: null,
    paidBy: null,
  };
  write([reservation, ...read()]);
  return reservation;
}

/** Staff action at the caisse. Separate from createReservation so the visitor flow can never reach it. */
export function markPaid(id: string, by = "Caisse"): Reservation | undefined {
  const list = read();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return undefined;
  list[i] = { ...list[i], status: "PAYEE", paidAt: new Date().toISOString(), paidBy: by };
  write(list);
  return list[i];
}

/** Undo a mis-tap at the desk. Keeps the row; only the payment state goes back. */
export function markUnpaid(id: string): Reservation | undefined {
  const list = read();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return undefined;
  list[i] = { ...list[i], status: "EN_ATTENTE", paidAt: null, paidBy: null };
  write(list);
  return list[i];
}

export function cancelReservation(id: string): Reservation | undefined {
  const list = read();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return undefined;
  list[i] = { ...list[i], status: "ANNULEE" };
  write(list);
  return list[i];
}

// ---------------------------------------------------------------- validation

/**
 * Moroccan mobile numbers, the way people actually type them: 0612345678, 06 12 34 56 78,
 * +212612345678, 00212 6 12 34 56 78. We keep the digits and normalise to 06…/07… so the
 * desk can search by number without guessing which format the visitor used.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("212")) return "0" + digits.slice(3);
  if (digits.startsWith("00212")) return "0" + digits.slice(5);
  return digits;
}

export function isValidPhone(raw: string): boolean {
  const n = normalizePhone(raw);
  return /^0[5-7]\d{8}$/.test(n);
}

export function formatPhone(raw: string): string {
  const n = normalizePhone(raw);
  if (n.length !== 10) return raw;
  return `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
}

export function isValidEmail(raw: string): boolean {
  if (!raw.trim()) return true; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

export function kartImage(color: KartColor): string {
  return KART_COLORS.find((k) => k.value === color)?.image ?? KART_COLORS[0].image;
}

export function kartLabel(color: KartColor): string {
  return KART_COLORS.find((k) => k.value === color)?.label ?? color;
}

export function raceTypeLabel(type: RaceType): string {
  return RACE_TYPES.find((r) => r.value === type)?.label ?? type;
}
