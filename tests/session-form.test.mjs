// The rule that decides whether "Créer la session" exists. Reimplemented from lib/session-form.ts
// the way the other tests do, and checked field by field.
import { strict as assert } from "node:assert";
import test from "node:test";

function sessionFormIssues(form) {
  const issues = [];
  if (!form.name.trim()) issues.push({ field: "name", message: "Donnez un nom à la session." });
  if (!Number.isFinite(form.durationMin) || form.durationMin < 1) issues.push({ field: "duration", message: "Indiquez une durée d’au moins 1 minute." });
  else if (form.durationMin > 240) issues.push({ field: "duration", message: "240 minutes maximum." });
  const inPlay = form.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.name.trim() || r.kart.trim());
  if (inPlay.length === 0) { issues.push({ field: "rows", message: "Ajoutez au moins un pilote avec son kart." }); return issues; }
  const kartOwner = new Map();
  for (const { r, i } of inPlay) {
    const name = r.name.trim(), kart = r.kart.trim();
    if (!name) issues.push({ field: "row", row: i, part: "name", message: "Nom du pilote manquant." });
    if (!kart) issues.push({ field: "row", row: i, part: "kart", message: "Kart manquant." });
    else if (!/^\d+$/.test(kart) || Number(kart) < 1) issues.push({ field: "row", row: i, part: "kart", message: "Numéro de kart invalide." });
    else { const o = kartOwner.get(kart); if (o) issues.push({ field: "row", row: i, part: "kart", message: `Kart ${kart} déjà attribué à ${o}.` }); else kartOwner.set(kart, name || `pilote ${i + 1}`); }
  }
  return issues;
}
const ok = { name: "Course #28", durationMin: 8, rows: [{ name: "Ali", kart: "2" }, { name: "Sara", kart: "3" }] };

test("a complete form has no issues, so the button shows", () => assert.deepEqual(sessionFormIssues(ok), []));
test("a missing name blocks", () => assert.equal(sessionFormIssues({ ...ok, name: "  " })[0].field, "name"));
test("a zero or absurd duration blocks", () => {
  assert.equal(sessionFormIssues({ ...ok, durationMin: 0 })[0].field, "duration");
  assert.equal(sessionFormIssues({ ...ok, durationMin: 500 })[0].field, "duration");
});
test("no pilots at all blocks with one message, not one per row", () => {
  const i = sessionFormIssues({ ...ok, rows: [{ name: "", kart: "" }, { name: "", kart: "" }] });
  assert.equal(i.length, 1); assert.equal(i[0].field, "rows");
});
test("a name without a kart, and a kart without a name, are each pointed at", () => {
  const i = sessionFormIssues({ ...ok, rows: [{ name: "Ali", kart: "" }, { name: "", kart: "4" }] });
  assert.deepEqual(i.map((x) => [x.row, x.part]), [[0, "kart"], [1, "name"]]);
});
test("the same kart twice names who has it", () => {
  const i = sessionFormIssues({ ...ok, rows: [{ name: "Ali", kart: "2" }, { name: "Sara", kart: "2" }] });
  assert.equal(i.length, 1); assert.equal(i[0].row, 1); assert.match(i[0].message, /Kart 2 déjà attribué à Ali/);
});
test("a kart that is not a number is refused", () => assert.match(sessionFormIssues({ ...ok, rows: [{ name: "Ali", kart: "x" }] })[0].message, /invalide/));
test("an untouched empty row is not an error", () => assert.deepEqual(sessionFormIssues({ ...ok, rows: [...ok.rows, { name: "", kart: "" }] }), []));
