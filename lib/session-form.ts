// What must be true before a session can be created, said in the operator's words.
//
// Kept out of the page so the rule is testable without rendering the form, and so the same
// list drives both the red marks on the fields and the decision to show the button at all.

export type SessionRowInput = { name: string; kart: string; transponder?: string };

export type SessionFormInput = {
  name: string;
  durationMin: number;
  rows: SessionRowInput[];
};

export type FieldIssue =
  | { field: "name" | "duration"; message: string }
  | { field: "row"; row: number; part: "name" | "kart"; message: string }
  | { field: "rows"; message: string };

/** Every problem with the form, in reading order. Empty means the session can be created. */
export function sessionFormIssues(form: SessionFormInput): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (!form.name.trim()) issues.push({ field: "name", message: "Donnez un nom à la session." });

  if (!Number.isFinite(form.durationMin) || form.durationMin < 1) {
    issues.push({ field: "duration", message: "Indiquez une durée d’au moins 1 minute." });
  } else if (form.durationMin > 240) {
    issues.push({ field: "duration", message: "240 minutes maximum." });
  }

  // A row counts as "in play" once anything has been typed in it: a kart with no name is as
  // much a mistake as a name with no kart, and a wholly empty row is just an unused line.
  const inPlay = form.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.name.trim() || r.kart.trim());
  if (inPlay.length === 0) {
    issues.push({ field: "rows", message: "Ajoutez au moins un pilote avec son kart." });
    return issues;
  }

  const kartOwner = new Map<string, string>();
  for (const { r, i } of inPlay) {
    const name = r.name.trim();
    const kart = r.kart.trim();
    if (!name) issues.push({ field: "row", row: i, part: "name", message: "Nom du pilote manquant." });
    if (!kart) {
      issues.push({ field: "row", row: i, part: "kart", message: "Kart manquant." });
    } else if (!/^\d+$/.test(kart) || Number(kart) < 1) {
      issues.push({ field: "row", row: i, part: "kart", message: "Numéro de kart invalide." });
    } else {
      const owner = kartOwner.get(kart);
      if (owner) issues.push({ field: "row", row: i, part: "kart", message: `Kart ${kart} déjà attribué à ${owner}.` });
      else kartOwner.set(kart, name || `pilote ${i + 1}`);
    }
  }
  return issues;
}

/** The issue for one spot on the form, if any - what a field looks up to decide its border. */
export function issueFor(issues: FieldIssue[], field: "name" | "duration" | "rows"): string | null;
export function issueFor(issues: FieldIssue[], field: "row", row: number, part: "name" | "kart"): string | null;
export function issueFor(issues: FieldIssue[], field: string, row?: number, part?: string): string | null {
  for (const issue of issues) {
    if (issue.field !== field) continue;
    if (issue.field === "row") {
      if (issue.row === row && issue.part === part) return issue.message;
    } else {
      return issue.message;
    }
  }
  return null;
}
