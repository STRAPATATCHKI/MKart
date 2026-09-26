// A client who wants to race again, from the Liste d'attente's "+ Rejouer". Plain JavaScript,
// shared by the desk (tools/reservations/desk.mjs), which creates the reservation, and the
// dashboard's pop-up (components/caisse/replay-dialog.tsx), which finds the client.
//
// Racing again is a NEW reservation, never the old one moved back: the first race was paid and
// that payment stays in the till and the reports as it was. The new one waits in "En attente"
// with its own code, for the whole group or only the pilots who want another go, and is cashed
// like any other.

import { offerFits, offerTotal } from "./offer-rules.mjs";

/** The pack chosen at the counter, priced from the catalog for this many pilots. */
export function packOverrideFor(offer, pilots, by, at) {
  const n = Math.max(1, pilots);
  return {
    id: String(offer.id), label: String(offer.name).slice(0, 40),
    basis: offer.basis === "groupe" ? "groupe" : "personne",
    price: Math.round(Number(offer.price)) || 0,
    total: offerTotal(offer, n),
    pilots: n, fits: offerFits(offer, n),
    by: by || "CAISSE", at,
  };
}

/**
 * The reservation for another race, or an error message (a string).
 *   pilotIds  the pilots racing again; empty or missing = the whole group
 *   offer     the pack chosen (an enabled catalog offer), or null to choose it later
 *   ids       { id, code, pilotId() } fresh identifiers from the desk
 */
export function replayReservation(source, { pilotIds, offer, by, clientCode, at, ids }) {
  if (!source) return "Réservation introuvable.";
  if (source.status === "SUPPRIMEE") return "Cette réservation est dans Supprimées : restaurez-la d'abord.";
  const all = Array.isArray(source.pilots) ? source.pilots : [];
  const wanted = Array.isArray(pilotIds) && pilotIds.length ? new Set(pilotIds.map(String)) : null;
  const chosen = wanted ? all.filter((p) => wanted.has(String(p.id))) : all;
  if (!chosen.length) return "Choisissez au moins un pilote.";

  // The name on the row is who stands at the counter: the booker if they race again, otherwise
  // the first pilot racing. The phone stays the group's, the only number we have.
  const names = chosen.map((p) => p.fullName);
  const contactName = names.includes(source.contactName) || !wanted ? source.contactName : names[0];
  const origin = source.replayOf || null;

  return {
    id: ids.id,
    code: ids.code,
    channel: "guichet",
    contactName,
    phone: source.phone || "",
    email: source.email || null,
    raceType: source.raceType || "practice",
    pilots: chosen.map((p) => ({ id: ids.pilotId(), fullName: p.fullName, kartColor: p.kartColor || "blue", kartNumber: null })),
    paymentMethod: source.paymentMethod === "Carte bancaire" ? "Carte bancaire" : "Espèces",
    status: "EN_ATTENTE",
    note: null,
    createdAt: at,
    paidAt: null,
    paidBy: null,
    sessionId: null,
    // Where it comes from: the reservation raced before, and the code the phone showed the
    // client on their first inscription (kept along a chain of re-races).
    replayOf: { code: source.code, clientCode: (origin && origin.clientCode) || clientCode || null },
    packOverride: offer ? packOverrideFor(offer, chosen.length, by, at) : null,
  };
}

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const digits = (s) => String(s || "").replace(/\D/g, "").replace(/^(?:00)?212/, "0");

/**
 * The reservations a search in the pop-up finds, newest first: by any pilot's name or the
 * booker's (accents and case ignored, every word must match), the desk code, the client code,
 * or the phone. Deleted and cancelled reservations are never offered.
 */
export function replayMatches(reservations, query, clientCodeOf, limit = 20) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const qd = digits(query);
  const live = (reservations || []).filter((r) => r && r.status !== "SUPPRIMEE" && r.status !== "ANNULEE");
  const hit = (r) => {
    if (!words.length) return true;
    if (qd.length >= 4 && digits(r.phone).includes(qd)) return true;
    const codes = [r.code, clientCodeOf ? clientCodeOf(r.code) : null, r.replayOf && r.replayOf.clientCode].map(fold);
    if (words.length === 1 && codes.some((c) => c && c.includes(words[0]))) return true;
    const names = [r.contactName, ...(r.pilots || []).map((p) => p.fullName)].map(fold);
    return names.some((n) => words.every((w) => n.includes(w)));
  };
  return live.filter(hit)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, limit);
}

/** The open reservation (waiting or at the counter) a pilot of this name is already in, if any. */
export function alreadyWaiting(reservations, fullName) {
  const name = fold(fullName);
  if (!name) return null;
  return (reservations || []).find((r) => (r.status === "EN_ATTENTE" || r.status === "AU_GUICHET")
    && (r.pilots || []).some((p) => fold(p.fullName) === name)) || null;
}
