// Which offers suit a group of pilots, what they cost, and which one to suggest.
//
// Plain JavaScript with no imports, because three different places must agree on it exactly:
//   - the dashboard (lib/catalog.ts re-exports these for the Packs & ventes page);
//   - the bridge, which prices every sign-up and refuses a pack that does not fit the group;
//   - the phone form, which embeds the source of the four functions below as they are.
// If the phone showed "300 DH" and the bridge charged something else, the client would be told
// one price and asked for another at the counter. One copy of the rules makes that impossible.
//
// The form embeds these with Function.prototype.toString(), so keep them self-contained: no
// imports, no helpers outside the function, nothing newer than the phones at the venue run.

/** The seed catalog: what MegaKart sells until someone edits it on the dashboard. */
export const SEED_OFFERS = [
  { id: "bronze", kind: "individuel", name: "Bronze", color: "#cd7f32", description: "L’offre idéale pour découvrir le karting.",
    price: 250, originalPrice: 300, basis: "personne", people: null, minPeople: null, capacity: "", period: "unique",
    unit: "sessions", quantity: 3, bonus: 0, sessionMinutes: 8,
    extras: ["Sensations garanties"], audience: "Nouveaux clients · Débutants · Clients occasionnels", enabled: true },
  { id: "silver", kind: "individuel", name: "Silver", color: "#c0c7cf", description: "Plus de sessions, plus de vitesse et d’adrénaline.",
    price: 450, originalPrice: null, basis: "personne", people: null, minPeople: null, capacity: "", period: "unique",
    unit: "sessions", quantity: 5, bonus: 1, sessionMinutes: 8,
    extras: ["Inscription anticipée"], audience: "Clients réguliers · Passionnés · Groupes", enabled: true },
  { id: "gold", kind: "individuel", name: "Gold", color: "#e3b341", description: "L’expérience la plus intense de la gamme packs.",
    price: 700, originalPrice: 900, basis: "personne", people: null, minPeople: null, capacity: "", period: "unique",
    unit: "sessions", quantity: 7, bonus: 2, sessionMinutes: 8,
    extras: ["Inscription anticipée"], audience: "Passionnés · Clients réguliers · Groupes", enabled: true },
  { id: "famille", kind: "famille", name: "Pack Famille", color: "#38e07b", description: "Toute la famille en piste, chacun dans le bon kart.",
    price: 300, originalPrice: null, basis: "groupe", people: 4, minPeople: 3, capacity: "2 Juniors + 2 Adultes", period: "unique",
    unit: "sessions", quantity: 1, bonus: 0, sessionMinutes: 8,
    extras: ["Karts adaptés", "Briefing de sécurité", "Photos souvenirs"], audience: "Familles · Parents avec enfants · Sorties familiales", enabled: true },
  { id: "amis", kind: "amis", name: "Pack Amis", color: "#2b7de9", description: "À quatre, le cinquième roule gratuitement.",
    price: 400, originalPrice: null, basis: "groupe", people: 5, minPeople: 4, capacity: "4 personnes · 5e gratuite", period: "unique",
    unit: "sessions", quantity: 1, bonus: 0, sessionMinutes: 8,
    extras: ["Tarif préférentiel", "Session privatisée", "Ambiance garantie"], audience: "Groupes d’amis · Collègues · Anniversaires · Événements privés", enabled: true },
  { id: "starter", kind: "abonnement", name: "Starter", color: "#8b5cf6", description: "Un rythme régulier, un budget maîtrisé.",
    price: 450, originalPrice: null, basis: "personne", people: null, minPeople: null, capacity: "", period: "mois",
    unit: "sessions", quantity: 5, bonus: 0, sessionMinutes: 8,
    extras: ["Tarif préférentiel", "Inscription anticipée à la session", "Bonus au renouvellement"], audience: "Débutants · Clients réguliers · Budget mensuel maîtrisé", enabled: true },
  { id: "pro", kind: "abonnement", name: "Pro", color: "#2b7de9", description: "Pour ceux qui roulent chaque semaine.",
    price: 850, originalPrice: null, basis: "personne", people: null, minPeople: null, capacity: "", period: "mois",
    unit: "sessions", quantity: 10, bonus: 1, sessionMinutes: 8,
    extras: ["Sessions supplémentaires à tarif réduit", "Inscription anticipée à la session"], audience: "Passionnés · Clients fréquents · Pilotes amateurs", enabled: true },
  { id: "vip", kind: "abonnement", name: "VIP Racing", color: "#e3b341", description: "La pratique intensive, et les soirées privées.",
    price: 1600, originalPrice: null, basis: "personne", people: null, minPeople: null, capacity: "", period: "mois",
    unit: "sessions", quantity: 20, bonus: 2, sessionMinutes: 8,
    extras: ["Tarifs exclusifs", "Invitations à des événements privés", "Inscription anticipée à la session"], audience: "Passionnés confirmés · Pratique intensive · Événements privés", enabled: true },
];

/**
 * How many pilots a group offer is for: {min, max}, or null for a per-person offer.
 * max is the number the price covers; min is the smallest group it is offered to. A catalog
 * saved before min existed gets one seat of slack: a pack for 4 is offered to 3 or 4.
 */
export function groupRange(o) {
  if (!o || o.basis !== "groupe") return null;
  var max = Math.round(Number(o.people));
  if (!(max >= 2)) max = 2;
  var min = o.minPeople == null ? max - 1 : Math.round(Number(o.minPeople));
  if (!(min >= 2)) min = 2;
  if (min > max) min = max;
  return { min: min, max: max };
}

/** Whether this offer may be sold to a sign-up of n pilots. */
export function offerFits(o, n) {
  if (!o || o.enabled === false || !(n >= 1)) return false;
  var range = groupRange(o);
  if (range) return n >= range.min && n <= range.max;
  // A subscription belongs to one person: it is offered to a pilot signing up alone.
  if (o.period === "mois" || o.period === "semaine") return n === 1;
  return true;
}

/** What the counter collects for n pilots: a group price is the price, a personal one is times n. */
export function offerTotal(o, n) {
  if (!o || !(n >= 1)) return null;
  var price = Math.round(Number(o.price));
  if (!(price >= 0)) return null;
  return o.basis === "groupe" ? price : price * n;
}

/**
 * The offers for n pilots, in catalog order, sorted into what the form shows:
 *   group         group offers the size fits (only when n >= 2);
 *   packs         per-person, one-off packs (each pilot pays);
 *   sessions      the simple prices: one session of 8, 16... minutes, per pilot;
 *   subscriptions weekly and monthly passes (only when n === 1);
 * and the one to preselect: for a group, the group offer that fits most snugly (fewest paid
 * seats left empty), then the cheapest; otherwise the first pack in catalog order.
 */
export function offersFor(offers, n) {
  var fits = (offers || []).filter(function (o) { return offerFits(o, n); });
  var group = fits.filter(function (o) { return o.basis === "groupe"; });
  var sessions = fits.filter(function (o) { return o.basis !== "groupe" && o.kind === "session"; });
  var packs = fits.filter(function (o) { return o.basis !== "groupe" && o.kind !== "session" && o.period !== "mois" && o.period !== "semaine"; });
  var subscriptions = fits.filter(function (o) { return o.basis !== "groupe" && o.kind !== "session" && (o.period === "mois" || o.period === "semaine"); });
  var best = null;
  var bestEmpty = 0;
  group.forEach(function (o) {
    var empty = groupRange(o).max - n;
    if (!best || empty < bestEmpty || (empty === bestEmpty && o.price < best.price)) { best = o; bestEmpty = empty; }
  });
  if (!best) best = packs[0] || sessions[0] || subscriptions[0] || null;
  return { group: group, packs: packs, sessions: sessions, subscriptions: subscriptions, recommended: best ? best.id : null };
}
