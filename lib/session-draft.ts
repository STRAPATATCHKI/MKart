// The race being filled in on Sessions (name, duration, pilots and karts), kept in this browser
// as it is typed. It used to live only in the page: going to Course en direct and back threw the
// pilots away. Groups sent from Liste d'attente wait in lib/session-queue.ts until « Ajouter »
// merges their pilots into this form (mergePilots).

export type DraftRow = { name: string; kart: string; transponder: string; color?: number };
export type SessionDraft = {
  name: string;
  type: string;
  durationMin: number;
  rows: DraftRow[];
  gridManual: boolean;
};

export const DRAFT_KEY = "megakart-session-draft-v1";
/** Fired in this tab when the draft changes from outside the form (Liste d'attente). */
export const DRAFT_CHANGED = "mk-session-draft-changed";

const emptyRow = (): DraftRow => ({ name: "", kart: "", transponder: "" });
export const emptyDraft = (): SessionDraft => ({ name: "", type: "practice", durationMin: 8, rows: [emptyRow(), emptyRow()], gridManual: false });

const sameDriver = (a: string, b: string) =>
  a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
  === b.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The pilots added to the form: each fills the first empty row, or a new one; a pilot already
 * in the form is not added twice (the same person cannot race twice in one race).
 */
export function mergePilots(rows: DraftRow[], pilots: { name: string; kart?: number | null; color?: number }[]): { rows: DraftRow[]; added: string[]; already: string[] } {
  const next = rows.map((r) => ({ ...r }));
  const added: string[] = [];
  const already: string[] = [];
  for (const p of pilots) {
    const name = p.name.trim();
    if (!name) continue;
    if (next.some((r) => r.name.trim() && sameDriver(r.name, name))) { already.push(name); continue; }
    const row: DraftRow = { name, kart: p.kart ? String(p.kart) : "", transponder: "", ...(p.color ? { color: p.color } : {}) };
    const free = next.findIndex((r) => !r.name.trim());
    if (free < 0) next.push(row); else next[free] = { ...next[free], ...row };
    added.push(name);
  }
  return { rows: next, added, already };
}

/** Whether every one of these names is already in the form. */
export function allInDraft(draft: SessionDraft | null, names: string[]): boolean {
  if (!draft || !names.length) return false;
  return names.every((n) => draft.rows.some((r) => r.name.trim() && sameDriver(r.name, n)));
}

function valid(v: unknown): v is SessionDraft {
  const d = v as SessionDraft;
  return !!d && typeof d === "object" && Array.isArray(d.rows) && typeof d.durationMin === "number";
}

export function loadDraft(): SessionDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!valid(parsed)) return null;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      type: typeof parsed.type === "string" ? parsed.type : "practice",
      durationMin: parsed.durationMin > 0 ? parsed.durationMin : 8,
      rows: parsed.rows.length ? parsed.rows.map((r) => ({
        name: String(r?.name ?? ""), kart: String(r?.kart ?? ""), transponder: String(r?.transponder ?? ""),
        ...(typeof r?.color === "number" ? { color: r.color } : {}),
      })) : emptyDraft().rows,
      gridManual: !!parsed.gridManual,
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: SessionDraft): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* private window: the form still works */ }
}

/**
 * The next race's name, following the day's numbering: after "SESSION 25" - or "Session 9",
 * "SESSION14", even "SESSON 23" - comes "SESSION 26"; "SESSION 1" on a day with none yet.
 * A name with no number ("SESSION TEST") does not count.
 */
export function nextSessionName(names: (string | null | undefined)[]): string {
  let max = 0;
  for (const name of names) {
    const m = /^\s*s[a-z]*\s*(\d{1,3})\s*$/i.exec(name ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `SESSION ${max + 1}`;
}
