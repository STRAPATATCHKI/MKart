// Décaissements: money taken out of the venue (fuel bought, a part, a supplier, an advance), asked
// for at the desk and approved or refused from the manager's app. Plain JavaScript, shared by the
// desk (which keeps them: tools/reservations/desk.mjs), the bridge (which carries them to Firebase
// and brings the app's decisions back), the MegaKart API and the dashboard.
//
// The life of one:
//   EN_ATTENTE  created at the desk, waiting for the app
//   APPROUVE    approved in the app          -> the cashier hands the money out -> DECAISSE
//   REFUSE      refused in the app (final)
//   ANNULE      withdrawn at the desk while still waiting (final)
// Every step is added to its history - what happened, when, by whom, from where, and why - and
// nothing is ever removed from it.

export const STATUSES = ["EN_ATTENTE", "APPROUVE", "REFUSE", "ANNULE", "DECAISSE"];

export const STATUS_FR = {
  EN_ATTENTE: "En attente de validation",
  APPROUVE: "Approuvé",
  REFUSE: "Refusé",
  ANNULE: "Annulé",
  DECAISSE: "Décaissé",
};

export const CATEGORIES = [
  { id: "carburant", label: "Carburant" },
  { id: "pieces", label: "Pièces et entretien des karts" },
  { id: "fournitures", label: "Fournitures et consommables" },
  { id: "fournisseur", label: "Fournisseur / facture" },
  { id: "personnel", label: "Personnel (avance, prime, salaire)" },
  { id: "marketing", label: "Marketing et publicité" },
  { id: "loyer", label: "Loyer, eau, électricité, internet" },
  { id: "autre", label: "Autre" },
];

// Every décaissement is cash taken from the till (decided 2026-09-27): the method is kept on each
// request, always "especes", so the app and any older reader still find it.
export const METHODS = [
  { id: "especes", label: "Espèces (sortie de caisse)" },
];

export const EVENT_FR = {
  cree: "Demande créée",
  piece: "Photo jointe",
  approuve: "Approuvé",
  refuse: "Refusé",
  annule: "Annulé",
  decaisse: "Argent remis",
};

const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * A new request as typed at the desk, checked: the amount, what it is for, and who it goes to are
 * required - a décaissement nobody can explain later is exactly what this is here to prevent.
 * Returns { error } or { value }.
 */
export function checkNew(body) {
  const amount = Math.round(Number(String(body?.amount ?? "").replace(",", ".")) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Indiquez le montant (en DH)." };
  if (amount > 1_000_000) return { error: "Montant trop élevé." };
  const category = CATEGORIES.find((c) => c.id === body?.category)?.id;
  if (!category) return { error: "Choisissez le motif." };
  const description = clean(body?.description, 500);
  if (description.length < 5) return { error: "Décrivez la dépense (au moins quelques mots)." };
  const beneficiary = clean(body?.beneficiary, 80);
  if (beneficiary.length < 2) return { error: "Indiquez à qui l’argent est remis (personne ou fournisseur)." };
  const method = "especes";
  const requestedBy = clean(body?.requestedBy, 40);
  if (requestedBy.length < 2) return { error: "Indiquez qui fait la demande." };
  return {
    value: {
      amount, category, description, beneficiary, method, requestedBy,
      reference: clean(body?.reference, 60) || null,
      urgent: body?.urgent === true,
    },
  };
}

/** The next code, DC-0001, DC-0002...: never reused, even after a cancelled request. */
export function nextCode(list) {
  let max = 0;
  for (const d of list || []) {
    const m = /^DC-(\d+)$/.exec(d?.code ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `DC-${String(max + 1).padStart(4, "0")}`;
}

// ---- photos (the ticket, the invoice, a screenshot of a transfer) ----------------------------
// Sent by the dashboard as data: URLs, already shrunk; kept by the desk as files beside the
// requests, and by Firebase apart from the list, so the list stays light.

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const IMAGE_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** One photo as a data: URL, checked. Returns { error } or { value: { type, ext, base64, size } }. */
export function checkImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl ?? ""));
  if (!m) return { error: "Photo illisible : JPEG, PNG ou WebP." };
  const size = Math.floor((m[2].length * 3) / 4) - (m[2].endsWith("==") ? 2 : m[2].endsWith("=") ? 1 : 0);
  if (size > MAX_ATTACHMENT_BYTES) return { error: "Photo trop lourde (4 Mo au plus)." };
  return { value: { type: m[1], ext: IMAGE_EXT[m[1]], base64: m[2], size } };
}

/** Photos added after the request was made (the receipt once the money is out, say). */
export function withAttachments(d, metas, { by, at }) {
  if (!d) return { error: "Décaissement introuvable.", status: 404 };
  if (!metas.length) return { error: "Aucune photo.", status: 400 };
  if ((d.attachments?.length ?? 0) + metas.length > MAX_ATTACHMENTS) return { error: `${MAX_ATTACHMENTS} photos au plus par demande.`, status: 400 };
  return {
    value: {
      ...d, attachments: [...(d.attachments || []), ...metas],
      history: [...(d.history || []), { at, event: "piece", by: clean(by, 40) || "ACCUEIL", via: "accueil", note: `${metas.length} photo${metas.length > 1 ? "s" : ""}` }],
      updatedAt: at,
    },
  };
}

/** A request, as the desk stores it. `attachments`: the photos sent with it ({ id, type, size, addedAt }). */
export function create(value, { id, code, at, attachments = [] }) {
  return {
    id, code, ...value,
    status: "EN_ATTENTE",
    createdAt: at,
    attachments,
    decision: null,        // { decision: "approve"|"refuse", by, at, comment, via }
    paidOutAt: null,
    paidOutBy: null,
    history: [{ at, event: "cree", by: value.requestedBy, via: "accueil", note: attachments.length ? `avec ${attachments.length} photo${attachments.length > 1 ? "s" : ""}` : null }],
    updatedAt: at,
  };
}

/** The app's answer, checked. Returns { error } or { value }. */
export function checkDecision(body) {
  const raw = String(body?.decision ?? "").toLowerCase();
  const decision = ["approve", "approuve", "approuver", "approved"].includes(raw) ? "approve"
    : ["refuse", "refuser", "refused", "reject", "rejected"].includes(raw) ? "refuse" : null;
  if (!decision) return { error: "decision : \"approve\" ou \"refuse\"." };
  const by = clean(body?.by, 60);
  if (by.length < 2) return { error: "by : le nom de la personne qui décide." };
  const comment = clean(body?.comment, 300) || null;
  if (decision === "refuse" && !comment) return { error: "comment : dites pourquoi la demande est refusée." };
  return { value: { decision, by, comment } };
}

/** Applies the app's decision. Returns { error, status } or { value } (the updated request). */
export function decide(d, { decision, by, comment }, { at, via = "application" }) {
  if (!d) return { error: "Décaissement introuvable.", status: 404 };
  if (d.status !== "EN_ATTENTE") return { error: `Déjà traité : ${STATUS_FR[d.status] ?? d.status}.`, status: 409 };
  const event = decision === "approve" ? "approuve" : "refuse";
  return {
    value: {
      ...d,
      status: decision === "approve" ? "APPROUVE" : "REFUSE",
      decision: { decision, by, at, comment: comment ?? null, via },
      history: [...(d.history || []), { at, event, by, via, note: comment ?? null }],
      updatedAt: at,
    },
  };
}

/** Withdrawn at the desk, only while it waits. */
export function cancel(d, { by, reason, at }) {
  if (!d) return { error: "Décaissement introuvable.", status: 404 };
  if (d.status !== "EN_ATTENTE") return { error: `Plus possible : ${STATUS_FR[d.status] ?? d.status}.`, status: 409 };
  const note = clean(reason, 200) || null;
  return { value: { ...d, status: "ANNULE", history: [...(d.history || []), { at, event: "annule", by: clean(by, 40) || "ACCUEIL", via: "accueil", note }], updatedAt: at } };
}

/** The money handed out, only once approved. */
export function payOut(d, { by, at, note }) {
  if (!d) return { error: "Décaissement introuvable.", status: 404 };
  if (d.status !== "APPROUVE") return { error: d.status === "EN_ATTENTE" ? "En attente de validation par l’application." : `Plus possible : ${STATUS_FR[d.status] ?? d.status}.`, status: 409 };
  const who = clean(by, 40) || "ACCUEIL";
  return {
    value: {
      ...d, status: "DECAISSE", paidOutAt: at, paidOutBy: who,
      history: [...(d.history || []), { at, event: "decaisse", by: who, via: "accueil", note: clean(note, 200) || null }],
      updatedAt: at,
    },
  };
}

/** What the day's décaissements add up to, by state. */
export function totals(list) {
  const sum = (s) => (list || []).filter((d) => d.status === s).reduce((n, d) => n + (d.amount || 0), 0);
  return {
    pending: (list || []).filter((d) => d.status === "EN_ATTENTE").length,
    pendingDh: sum("EN_ATTENTE"),
    approvedDh: sum("APPROUVE"),
    paidOutDh: sum("DECAISSE"),
  };
}

const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * One request as the manager's app reads it (Firebase /reports/disbursements/<id>, and the API):
 * times in ms, labels in French beside the codes, the whole history. Built on the venue PC, whose
 * calendar is the venue's.
 */
export function reportDoc(d) {
  const ms = (iso) => (iso ? Date.parse(iso) : null);
  const created = ms(d.createdAt);
  return {
    id: d.id, code: d.code, day: created != null ? localDay(created) : null,
    amount: d.amount, category: d.category, categoryLabel: CATEGORIES.find((c) => c.id === d.category)?.label ?? d.category,
    description: d.description, beneficiary: d.beneficiary,
    method: d.method, methodLabel: METHODS.find((m) => m.id === d.method)?.label ?? d.method,
    reference: d.reference ?? null, urgent: !!d.urgent, requestedBy: d.requestedBy,
    status: d.status, statusLabel: STATUS_FR[d.status] ?? d.status,
    createdAt: created,
    decision: d.decision ? { ...d.decision, at: ms(d.decision.at) } : null,
    paidOutAt: ms(d.paidOutAt), paidOutBy: d.paidOutBy ?? null,
    // The photos themselves: GET /v1/disbursements/<id>/attachments/<attachment id> (the API).
    attachments: (d.attachments || []).map((a) => ({ id: a.id, type: a.type, size: a.size, addedAt: ms(a.addedAt), path: `/v1/disbursements/${d.id}/attachments/${a.id}` })),
    history: (d.history || []).map((h) => ({ at: ms(h.at), event: h.event, label: EVENT_FR[h.event] ?? h.event, by: h.by ?? null, via: h.via ?? null, note: h.note ?? null })),
    updatedAt: ms(d.updatedAt),
  };
}
