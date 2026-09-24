// How many people are still waiting on the desk, as a number small enough to sit in the nav.
//
// The count is the thing the operator has not dealt with yet: a group that has arrived but has
// not been cashed in. Anything already paid, on track, finished, absent or cancelled has left
// the operator's hands, so counting it would make the badge permanent furniture and therefore
// ignorable. Kept out of the component so the rule is testable without rendering a sidebar.

/** The statuses the Liste d'attente itself treats as "still waiting" (file-attente-view.tsx). */
const WAITING = new Set(["EN_ATTENTE", "AU_GUICHET"]);

export type BadgeReservation = { status?: string | null; pilots?: unknown[] | null };

/** Groups still to be handled. Counts rows, because rows are what the operator works through. */
export function waitingCount(reservations: BadgeReservation[] | null | undefined): number {
  if (!Array.isArray(reservations)) return 0;
  let n = 0;
  for (const r of reservations) if (r && typeof r.status === "string" && WAITING.has(r.status)) n += 1;
  return n;
}

/** People inside those groups — for the tooltip, where "3 groupes · 7 pilotes" is worth saying. */
export function waitingPilots(reservations: BadgeReservation[] | null | undefined): number {
  if (!Array.isArray(reservations)) return 0;
  let n = 0;
  for (const r of reservations) {
    if (!r || typeof r.status !== "string" || !WAITING.has(r.status)) continue;
    n += Array.isArray(r.pilots) ? r.pilots.length : 0;
  }
  return n;
}

/**
 * What the pill reads. Null means draw nothing at all: a badge showing "0" is a badge that is
 * always there, and a nav item that always has a badge stops meaning anything.
 */
export function badgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** The title attribute, in the operator's language. */
export function badgeTitle(groups: number, pilots: number): string {
  if (groups <= 0) return "Personne en attente";
  const g = `${groups} ${groups > 1 ? "groupes" : "groupe"} en attente`;
  if (pilots <= 0) return g;
  return `${g} · ${pilots} ${pilots > 1 ? "pilotes" : "pilote"}`;
}
