// Spare parts for the karts: what is on the shelf, what to reorder, and which kart each part
// went on. Pure data and rules - the desk keeps the file (garage.json), the Garage page edits it,
// tests/garage-parts.test.mjs checks the rules.

export type PartCategory = "pneus" | "freinage" | "transmission" | "moteur" | "carrosserie" | "electrique" | "autre";
export type PartFit = "tous" | "junior" | "gt";

export type Part = {
  id: string;
  name: string;
  category: PartCategory;
  /** Which karts it fits. */
  fits: PartFit;
  /** "pièce", "jeu", "L"... */
  unit: string;
  stock: number;
  /** At or below this, the part is flagged "à commander". */
  minStock: number;
  /** Price of one unit in dirhams, for the value of the stock. Null when unknown. */
  unitPrice: number | null;
  supplier: string;
  note: string;
};

/** One movement: in (qty > 0, a delivery) or out (qty < 0, fitted on a kart or thrown away). */
export type PartMove = {
  id: string;
  partId: string;
  partName: string;
  qty: number;
  kart: number | null;
  note: string;
  at: string;
  by: string | null;
};

export type Garage = { version: 1; parts: Part[]; moves: PartMove[]; savedAt?: string | null };

export const CATEGORY_LABELS: Record<PartCategory, string> = {
  pneus: "Pneus", freinage: "Freinage", transmission: "Transmission", moteur: "Moteur",
  carrosserie: "Carrosserie", electrique: "Électrique", autre: "Autre",
};
export const CATEGORY_ORDER: PartCategory[] = ["pneus", "freinage", "transmission", "moteur", "carrosserie", "electrique", "autre"];
export const FIT_LABELS: Record<PartFit, string> = { tous: "Tous karts", junior: "Junior", gt: "GT" };

export const MAX_MOVES = 1000;

let seq = 0;
export const newId = (prefix: string) => {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
};

export function blankPart(): Part {
  return { id: newId("p"), name: "", category: "autre", fits: "tous", unit: "pièce", stock: 0, minStock: 1, unitPrice: null, supplier: "", note: "" };
}

export type PartIssue = { field: keyof Part; message: string };

export function partIssues(p: Part): PartIssue[] {
  const out: PartIssue[] = [];
  if (!p.name.trim()) out.push({ field: "name", message: "Nom de la pièce requis." });
  if (!Number.isInteger(p.stock) || p.stock < 0) out.push({ field: "stock", message: "0 ou plus." });
  if (!Number.isInteger(p.minStock) || p.minStock < 0) out.push({ field: "minStock", message: "0 ou plus." });
  if (p.unitPrice != null && (!Number.isFinite(p.unitPrice) || p.unitPrice < 0)) out.push({ field: "unitPrice", message: "Prix invalide." });
  return out;
}

export const isLow = (p: Part) => p.stock <= p.minStock;

/** What there is to reorder, emptiest first. */
export function toReorder(parts: Part[]): Part[] {
  return parts.filter(isLow).sort((a, b) => a.stock - a.minStock - (b.stock - b.minStock));
}

/** The value of what is on the shelf, and how many parts have no price to count. */
export function stockValue(parts: Part[]): { value: number; unpriced: number } {
  let value = 0;
  let unpriced = 0;
  for (const p of parts) {
    if (p.stock <= 0) continue;
    if (p.unitPrice == null) unpriced += 1; else value += p.stock * p.unitPrice;
  }
  return { value, unpriced };
}

/**
 * Record a movement: the stock changes and the movement is logged, newest first. A part cannot
 * go below zero - taking out more than there is means the count was wrong, and saying so is
 * better than a negative shelf.
 */
export function applyMove(garage: Garage, move: Omit<PartMove, "id" | "at" | "partName">): Garage | string {
  const part = garage.parts.find((p) => p.id === move.partId);
  if (!part) return "Pièce introuvable.";
  if (!Number.isInteger(move.qty) || move.qty === 0) return "Quantité invalide.";
  if (part.stock + move.qty < 0) return `Stock insuffisant : il reste ${part.stock} ${part.unit}.`;
  const logged: PartMove = { ...move, id: newId("m"), at: new Date().toISOString(), partName: part.name };
  return {
    ...garage,
    parts: garage.parts.map((p) => (p.id === part.id ? { ...p, stock: p.stock + move.qty } : p)),
    moves: [logged, ...garage.moves].slice(0, MAX_MOVES),
  };
}

/** Parts fitted on one kart, newest first - its repair history. */
export function kartHistory(garage: Garage, kart: number): PartMove[] {
  return garage.moves.filter((m) => m.kart === kart && m.qty < 0);
}

export function normalizeGarage(raw: unknown): Garage {
  const r = (raw && typeof raw === "object" ? raw : {}) as { parts?: unknown; moves?: unknown; savedAt?: unknown };
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
  const categories = new Set<string>(CATEGORY_ORDER);
  const parts: Part[] = (Array.isArray(r.parts) ? r.parts : []).slice(0, 300).flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const p = x as Record<string, unknown>;
    const name = str(p.name, 60);
    if (!name) return [];
    const price = p.unitPrice == null || p.unitPrice === "" ? null : Number(p.unitPrice);
    return [{
      id: str(p.id, 40) || newId("p"), name,
      category: (categories.has(String(p.category)) ? p.category : "autre") as PartCategory,
      fits: (p.fits === "junior" || p.fits === "gt" ? p.fits : "tous") as PartFit,
      unit: str(p.unit, 12) || "pièce",
      stock: int(p.stock), minStock: int(p.minStock),
      unitPrice: price != null && Number.isFinite(price) && price >= 0 ? Math.round(price) : null,
      supplier: str(p.supplier, 60), note: str(p.note, 160),
    }];
  });
  const moves: PartMove[] = (Array.isArray(r.moves) ? r.moves : []).slice(0, MAX_MOVES).flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const m = x as Record<string, unknown>;
    const qty = Math.round(Number(m.qty));
    if (!Number.isFinite(qty) || qty === 0) return [];
    const kart = Number(m.kart);
    return [{
      id: str(m.id, 40) || newId("m"), partId: str(m.partId, 40), partName: str(m.partName, 60), qty,
      kart: Number.isInteger(kart) && kart > 0 ? kart : null,
      note: str(m.note, 120), at: str(m.at, 40) || new Date().toISOString(), by: str(m.by, 8) || null,
    }];
  });
  return { version: 1, parts, moves, savedAt: typeof r.savedAt === "string" ? r.savedAt : null };
}

/** A starting shelf of the usual kart spares, all at zero: fill in the real counts once. */
export const SEED_GARAGE: Garage = {
  version: 1,
  savedAt: null,
  moves: [],
  parts: ([
    ["Pneus avant", "pneus", "jeu", 2],
    ["Pneus arrière", "pneus", "jeu", 2],
    ["Plaquettes de frein", "freinage", "jeu", 4],
    ["Disque de frein", "freinage", "pièce", 1],
    ["Chaîne de transmission", "transmission", "pièce", 2],
    ["Pignon / couronne", "transmission", "pièce", 1],
    ["Bougie d’allumage", "moteur", "pièce", 4],
    ["Filtre à air", "moteur", "pièce", 2],
    ["Huile moteur", "moteur", "L", 5],
    ["Câble d’accélérateur", "moteur", "pièce", 1],
    ["Pare-chocs avant", "carrosserie", "pièce", 1],
    ["Siège", "carrosserie", "pièce", 1],
    ["Batterie", "electrique", "pièce", 1],
  ] as Array<[string, PartCategory, string, number]>).map(([name, category, unit, minStock], i) => ({
    id: `seed-${i + 1}`, name, category, fits: "tous" as PartFit, unit, stock: 0, minStock,
    unitPrice: null, supplier: "", note: "",
  })),
};
