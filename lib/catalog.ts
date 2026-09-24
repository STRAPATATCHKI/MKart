// The MegaKart offer catalog: every pack, group offer and monthly pass the venue sells.
//
// It used to be three hard-coded lists in app/page.tsx, shown on three pages (Packs & ventes,
// Pass & fidélité, Rapports). Editing one meant editing code. Now the desk server keeps one
// catalog in catalog.json, the Packs & ventes page edits it, and all three pages read it - so a
// price changed at the counter is the price everywhere a minute later.
//
// Pure data and rules, no React: the same functions check a draft in the editor, render a
// card, and are exercised by tests/catalog.test.mjs.
//
// Who may buy what - a group offer only for a group its size, a subscription only for one
// pilot - lives in lib/offer-rules.mjs, shared with the bridge and the phone form, so the price
// the client sees on the phone is the price the counter asks for.

import * as rules from "./offer-rules.mjs";

export type OfferKind = "individuel" | "famille" | "amis" | "abonnement" | "autre" | "session";
export type OfferUnit = "sessions" | "tours" | "minutes";
export type PriceBasis = "personne" | "groupe";
export type OfferPeriod = "unique" | "semaine" | "mois";

export type Offer = {
  /** Stable id. Never reused for a different offer, so a sale recorded against it stays true. */
  id: string;
  kind: OfferKind;
  name: string;
  /** Accent colour of the pack, as #rrggbb. Drawn on the card's edge, price and badge. */
  color: string;
  description: string;
  /** Price in dirhams, for the basis and period below. */
  price: number;
  /** Crossed-out "was" price. Null when there is no promotion to show. */
  originalPrice: number | null;
  basis: PriceBasis;
  /** How many people a group price covers. Ignored for a per-person price. */
  people: number | null;
  /** The smallest group the offer is proposed to on the sign-up form. Null: one less than people. */
  minPeople: number | null;
  /** Free text for who the group is, e.g. "2 Juniors + 2 Adultes". */
  capacity: string;
  period: OfferPeriod;
  unit: OfferUnit;
  /** How many units are paid for: 3 sessions, 10 tours, 30 minutes. */
  quantity: number;
  /** Units given free on top. "5 sessions + 1 offerte" is quantity 5, bonus 1. */
  bonus: number;
  /** Track time per session, when the unit is sessions. Null when it does not apply. */
  sessionMinutes: number | null;
  /** What else comes with it: photos, briefing, priority booking... one line each. */
  extras: string[];
  audience: string;
  /** On sale. An offer switched off stays in the catalog, hidden from the pages. */
  enabled: boolean;
};

export type Catalog = { version: 1; offers: Offer[]; savedAt?: string | null };

export const KIND_LABELS: Record<OfferKind, { title: string; badge: string; lead: string }> = {
  individuel: { title: "Offres individuelles", badge: "PACK KARTING", lead: "Des formules progressives pour découvrir, pratiquer ou intensifier l’expérience." },
  famille:    { title: "Packs famille", badge: "PACK FAMILLE", lead: "Parents et enfants sur la même piste, karts adaptés à chacun." },
  amis:       { title: "Packs amis", badge: "PACK AMIS", lead: "Sorties entre amis, collègues et anniversaires." },
  abonnement: { title: "Abonnements mensuels", badge: "PASS MENSUEL", lead: "Un volume de roulage chaque mois, et la fidélité qui va avec." },
  autre:      { title: "Événements & autres", badge: "OFFRE", lead: "Privatisations, entreprises, offres ponctuelles." },
  session:    { title: "Tarifs à la session", badge: "PRIX SIMPLES", lead: "Une session sur la piste, un prix par pilote selon la durée." },
};
export const KIND_ORDER: OfferKind[] = ["individuel", "famille", "amis", "abonnement", "autre", "session"];

// ------------------------------------------------------------------- simple session prices

/** Minutes on track for one simple-price session. */
export function sessionLength(o: Pick<Offer, "unit" | "quantity" | "sessionMinutes">): number {
  if (o.unit === "minutes") return o.quantity;
  if (o.unit === "sessions" && o.sessionMinutes) return o.quantity * o.sessionMinutes;
  return 0;
}

/** A simple price as stored in the catalog: one session of `minutes`, per pilot. */
export function sessionOffer(minutes: number, price: number, note = "", keep?: Partial<Offer>): Offer {
  return {
    id: keep?.id ?? newOfferId(), kind: "session", name: `Session ${minutes} min`, color: keep?.color ?? "#d8ff35",
    description: note.trim().slice(0, LIMITS.description), price, originalPrice: null,
    basis: "personne", people: null, minPeople: null, capacity: "", period: "unique",
    unit: "minutes", quantity: minutes, bonus: 0, sessionMinutes: null,
    extras: [], audience: "", enabled: keep?.enabled ?? true,
  };
}

/** "12,5 DH la minute", for comparing durations. */
export function perMinuteLabel(o: Pick<Offer, "price" | "unit" | "quantity" | "sessionMinutes">): string | null {
  const minutes = sessionLength(o);
  if (!(minutes > 0) || !(o.price > 0)) return null;
  return `${(o.price / minutes).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} DH la minute`;
}

export const UNIT_LABELS: Record<OfferUnit, { one: string; many: string }> = {
  sessions: { one: "session", many: "sessions" },
  tours: { one: "tour", many: "tours" },
  minutes: { one: "minute", many: "minutes" },
};

/** Swatches offered in the editor; any #rrggbb can still be typed. */
export const PACK_COLORS = [
  "#d8ff35", "#38e07b", "#2b7de9", "#8b5cf6", "#e23b3b",
  "#f97316", "#e3b341", "#cd7f32", "#c0c7cf", "#f472b6",
];

export const LIMITS = { name: 40, description: 200, capacity: 60, audience: 120, extra: 80, extras: 12, offers: 60, price: 100_000 };

// ---------------------------------------------------------------------------------- display

export function totalUnits(o: Pick<Offer, "quantity" | "bonus">): number {
  return Math.max(0, o.quantity || 0) + Math.max(0, o.bonus || 0);
}

export function unitWord(unit: OfferUnit, n: number): string {
  return n > 1 ? UNIT_LABELS[unit].many : UNIT_LABELS[unit].one;
}

/** "9 sessions de 8 min", "10 tours", "30 minutes". */
export function volumeLabel(o: Pick<Offer, "quantity" | "bonus" | "unit" | "sessionMinutes" | "period">): string {
  const n = totalUnits(o);
  let text = `${n} ${unitWord(o.unit, n)}`;
  if (o.unit === "sessions" && o.sessionMinutes) text += ` de ${o.sessionMinutes} min`;
  if (o.period === "mois") text += " / mois";
  if (o.period === "semaine") text += " / semaine";
  return text;
}

/** "5 + 1 offerte", or null when nothing is free. */
export function bonusLabel(o: Pick<Offer, "quantity" | "bonus" | "unit">): string | null {
  if (!(o.bonus > 0)) return null;
  const word = o.unit === "sessions" ? (o.bonus > 1 ? "offertes" : "offerte") : (o.bonus > 1 ? "offerts" : "offert");
  return `${o.quantity} + ${o.bonus} ${word}`;
}

/** The saving line under a card, worked out rather than typed, so it cannot contradict the price. */
export function savingLabel(o: Pick<Offer, "price" | "originalPrice" | "bonus" | "unit" | "quantity">): string | null {
  const parts: string[] = [];
  if (o.originalPrice != null && o.originalPrice > o.price && o.originalPrice > 0) {
    const saved = o.originalPrice - o.price;
    const pct = (saved / o.originalPrice) * 100;
    parts.push(`${saved.toLocaleString("fr-FR")} DH économisés · ${pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`);
  }
  if (o.bonus > 0) {
    parts.push(`${o.bonus} ${unitWord(o.unit, o.bonus)} ${o.unit === "sessions" ? (o.bonus > 1 ? "offertes" : "offerte") : (o.bonus > 1 ? "offerts" : "offert")}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/** "250 DH", "300 DH / groupe de 4", "850 DH / mois". */
export function priceSuffix(o: Pick<Offer, "basis" | "people" | "period">): string {
  const bits: string[] = [];
  if (o.basis === "groupe") bits.push(o.people ? `groupe de ${o.people}` : "groupe");
  else bits.push("personne");
  if (o.period === "mois") bits.push("mois");
  if (o.period === "semaine") bits.push("semaine");
  return bits.join(" · ");
}

/** What one person pays, for comparing a group offer with individual ones. */
export function pricePerPerson(o: Pick<Offer, "price" | "basis" | "people">): number {
  if (o.basis === "groupe" && o.people && o.people > 0) return Math.round((o.price / o.people) * 10) / 10;
  return o.price;
}

// ---------------------------------------------------------------------------------- editing

let seq = 0;
export function newOfferId(): string {
  seq += 1;
  return `o-${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** A sensible blank for each kind, so the operator starts from something that already makes sense. */
export function blankOffer(kind: OfferKind): Offer {
  const base: Offer = {
    id: newOfferId(), kind, name: "", color: "#d8ff35", description: "",
    price: 0, originalPrice: null, basis: "personne", people: null, minPeople: null, capacity: "",
    period: "unique", unit: "sessions", quantity: 1, bonus: 0, sessionMinutes: 8,
    extras: [], audience: "", enabled: true,
  };
  if (kind === "famille") return { ...base, basis: "groupe", people: 4, minPeople: 3, capacity: "2 Juniors + 2 Adultes", color: "#38e07b" };
  if (kind === "amis") return { ...base, basis: "groupe", people: 5, minPeople: 4, capacity: "5 personnes", color: "#2b7de9" };
  if (kind === "abonnement") return { ...base, period: "mois", quantity: 5, color: "#8b5cf6" };
  return base;
}

export type OfferIssue = { field: keyof Offer | "extras"; message: string };

/** Everything wrong with one offer, in the operator's words. Empty means it can be saved. */
export function offerIssues(o: Offer): OfferIssue[] {
  const issues: OfferIssue[] = [];
  const name = (o.name || "").trim();
  if (!name) issues.push({ field: "name", message: "Donnez un nom à l’offre." });
  else if (name.length > LIMITS.name) issues.push({ field: "name", message: `${LIMITS.name} caractères maximum.` });
  if (!/^#[0-9a-fA-F]{6}$/.test(o.color || "")) issues.push({ field: "color", message: "Couleur invalide." });
  if (!Number.isFinite(o.price) || o.price < 0) issues.push({ field: "price", message: "Indiquez un prix." });
  else if (o.kind === "session" && !(o.price > 0)) issues.push({ field: "price", message: "Indiquez le prix de la session." });
  else if (o.price > LIMITS.price) issues.push({ field: "price", message: "Prix trop élevé." });
  if (o.originalPrice != null && (!Number.isFinite(o.originalPrice) || o.originalPrice <= o.price)) {
    issues.push({ field: "originalPrice", message: "L’ancien prix doit être plus élevé que le prix." });
  }
  if (!Number.isInteger(o.quantity) || o.quantity < 1) issues.push({ field: "quantity", message: "Au moins 1." });
  if (!Number.isInteger(o.bonus) || o.bonus < 0) issues.push({ field: "bonus", message: "0 ou plus." });
  if (o.basis === "groupe" && (!Number.isInteger(o.people) || (o.people ?? 0) < 2)) {
    issues.push({ field: "people", message: "Un groupe, c’est au moins 2 personnes." });
  } else if (o.basis === "groupe" && o.minPeople != null
    && (!Number.isInteger(o.minPeople) || o.minPeople < 2 || o.minPeople > (o.people ?? 0))) {
    issues.push({ field: "minPeople", message: `Entre 2 et ${o.people ?? 2}.` });
  }
  if (o.unit === "sessions" && o.sessionMinutes != null && (!Number.isInteger(o.sessionMinutes) || o.sessionMinutes < 1 || o.sessionMinutes > 240)) {
    issues.push({ field: "sessionMinutes", message: "Entre 1 et 240 minutes." });
  }
  if ((o.description || "").length > LIMITS.description) issues.push({ field: "description", message: `${LIMITS.description} caractères maximum.` });
  if ((o.extras || []).length > LIMITS.extras) issues.push({ field: "extras", message: `${LIMITS.extras} avantages maximum.` });
  if ((o.extras || []).some((e) => e.length > LIMITS.extra)) issues.push({ field: "extras", message: `Un avantage fait ${LIMITS.extra} caractères maximum.` });
  return issues;
}

/**
 * Coerce anything that claims to be a catalog into one: unknown fields dropped, numbers made
 * numbers, text trimmed and cut to length. The desk server applies the same rules on save, so
 * a hand-edited catalog.json or an old client cannot put something unrenderable on the pages.
 */
export function normalizeOffer(raw: unknown): Offer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const int = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : fallback);
  const kinds: OfferKind[] = ["individuel", "famille", "amis", "abonnement", "autre", "session"];
  const units: OfferUnit[] = ["sessions", "tours", "minutes"];
  const kind = kinds.includes(r.kind as OfferKind) ? (r.kind as OfferKind) : "autre";
  const unit = units.includes(r.unit as OfferUnit) ? (r.unit as OfferUnit) : "sessions";
  const name = str(r.name, LIMITS.name);
  if (!name) return null;
  const price = Math.max(0, int(r.price, 0));
  const original = r.originalPrice == null || r.originalPrice === "" ? null : int(r.originalPrice, 0);
  // A simple session price is always per pilot and paid once.
  const basis: PriceBasis = r.basis === "groupe" && kind !== "session" ? "groupe" : "personne";
  const minutes = r.sessionMinutes == null || r.sessionMinutes === "" ? null : int(r.sessionMinutes, 0);
  const people = basis === "groupe" ? Math.max(2, int(r.people, 2)) : null;
  const minRaw = r.minPeople == null || r.minPeople === "" ? null : int(r.minPeople, 0);
  return {
    id: str(r.id, 40) || newOfferId(),
    kind, name,
    color: /^#[0-9a-fA-F]{6}$/.test(String(r.color)) ? String(r.color).toLowerCase() : "#d8ff35",
    description: str(r.description, LIMITS.description),
    price,
    originalPrice: original != null && original > price ? original : null,
    basis,
    people,
    minPeople: people != null && minRaw != null ? Math.min(people, Math.max(2, minRaw)) : null,
    capacity: str(r.capacity, LIMITS.capacity),
    period: kind === "session" ? "unique" : r.period === "mois" ? "mois" : r.period === "semaine" ? "semaine" : "unique",
    unit,
    quantity: Math.max(1, int(r.quantity, 1)),
    bonus: Math.max(0, int(r.bonus, 0)),
    sessionMinutes: unit === "sessions" && minutes != null && minutes > 0 ? Math.min(240, minutes) : null,
    extras: Array.isArray(r.extras)
      ? r.extras.map((e) => str(e, LIMITS.extra)).filter(Boolean).slice(0, LIMITS.extras)
      : [],
    audience: str(r.audience, LIMITS.audience),
    enabled: r.enabled !== false,
  };
}

export function normalizeCatalog(raw: unknown): Catalog {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { offers?: unknown }).offers)
    ? (raw as { offers: unknown[] }).offers
    : [];
  const seen = new Set<string>();
  const offers: Offer[] = [];
  for (const item of list.slice(0, LIMITS.offers)) {
    const offer = normalizeOffer(item);
    if (!offer) continue;
    if (seen.has(offer.id)) offer.id = newOfferId();     // two offers must never share an id
    seen.add(offer.id);
    offers.push(offer);
  }
  const savedAt = raw && typeof raw === "object" ? (raw as { savedAt?: unknown }).savedAt : null;
  return { version: 1, offers, savedAt: typeof savedAt === "string" ? savedAt : null };
}

/** Offers on sale, of the given kinds, in catalog order. */
export function onSale(catalog: Catalog, filter?: (o: Offer) => boolean): Offer[] {
  return catalog.offers.filter((o) => o.enabled && (!filter || filter(o)));
}

// ---------------------------------------------------------------------------------- seed

/**
 * The catalog MegaKart already had, as it was hard-coded in the dashboard. Used when the desk
 * has no catalog.json yet, so the pages look exactly as before until someone edits them.
 */
export const SEED_CATALOG: Catalog = {
  version: 1,
  savedAt: null,
  offers: rules.SEED_OFFERS as Offer[],
};

// ------------------------------------------------------------------- who is offered what

/** {min, max} pilots for a group offer, null for a per-person one. */
export const groupRange = (o: Offer): { min: number; max: number } | null => rules.groupRange(o);
/** Whether the sign-up form proposes this offer to a group of n pilots. */
export const offerFits = (o: Offer, n: number): boolean => rules.offerFits(o, n);
/** What the counter collects for n pilots. */
export const offerTotal = (o: Offer, n: number): number | null => rules.offerTotal(o, n);
/** The offers for n pilots, as the form groups them, and the one it preselects. */
export const offersFor = (offers: Offer[], n: number): { group: Offer[]; packs: Offer[]; sessions: Offer[]; subscriptions: Offer[]; recommended: string | null } =>
  rules.offersFor(offers, n);

/** Who sees it on the sign-up form, in words: "Groupes de 3 à 4 pilotes". */
export function audienceOnForm(o: Offer): string {
  const range = groupRange(o);
  if (range) return range.min === range.max ? `Groupes de ${range.max} pilotes` : `Groupes de ${range.min} à ${range.max} pilotes`;
  if (o.period === "mois" || o.period === "semaine") return "Pilote seul";
  return "Tous · prix × pilotes";
}
