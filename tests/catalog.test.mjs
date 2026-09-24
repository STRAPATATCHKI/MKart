// The catalog rules, run against the real lib/catalog.ts compiled on the fly: the saving line
// must never contradict the price, a bad offer must never reach the pages, and the seed must
// reproduce the catalog MegaKart already had.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/catalog.ts", import.meta.url), "utf8");
// A module loaded from a data: URL has no folder, so point its one relative import at the file.
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace('"./offer-rules.mjs"', JSON.stringify(new URL("../lib/offer-rules.mjs", import.meta.url).href));
const C = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const offer = (over = {}) => ({ ...C.blankOffer("individuel"), name: "Test", price: 250, ...over });

test("the seed is today's eight offers, all valid", () => {
  assert.equal(C.SEED_CATALOG.offers.length, 8);
  for (const o of C.SEED_CATALOG.offers) assert.deepEqual(C.offerIssues(o), [], o.name);
  assert.deepEqual(C.SEED_CATALOG.offers.map((o) => o.name),
    ["Bronze", "Silver", "Gold", "Pack Famille", "Pack Amis", "Starter", "Pro", "VIP Racing"]);
});

test("the saving line is computed, and matches what the old page said", () => {
  const bronze = C.SEED_CATALOG.offers.find((o) => o.id === "bronze");
  assert.match(C.savingLabel(bronze), /50 DH économisés · 16,7 %/);
  const gold = C.SEED_CATALOG.offers.find((o) => o.id === "gold");
  assert.equal(C.totalUnits(gold), 9, "7 + 2 offertes");
  assert.match(C.savingLabel(gold), /200 DH économisés/);
  assert.match(C.savingLabel(gold), /2 sessions offertes/);
});

test("no promotion, no saving line", () => {
  assert.equal(C.savingLabel(offer({ originalPrice: null, bonus: 0 })), null);
});

test("an old price at or below the price is refused", () => {
  assert.equal(C.offerIssues(offer({ originalPrice: 250 }))[0].field, "originalPrice");
  assert.equal(C.offerIssues(offer({ originalPrice: 200 }))[0].field, "originalPrice");
  assert.deepEqual(C.offerIssues(offer({ originalPrice: 300 })), []);
});

test("a group needs at least two people, and its per-person price is worked out", () => {
  assert.equal(C.offerIssues(offer({ basis: "groupe", people: 1 }))[0].field, "people");
  const amis = C.SEED_CATALOG.offers.find((o) => o.id === "amis");
  assert.equal(C.pricePerPerson(amis), 80, "400 DH for 5");
  assert.equal(C.priceSuffix(amis), "groupe de 5");
});

test("monthly offers say so everywhere", () => {
  const pro = C.SEED_CATALOG.offers.find((o) => o.id === "pro");
  assert.equal(C.priceSuffix(pro), "personne · mois");
  assert.equal(C.volumeLabel(pro), "11 sessions de 8 min / mois");
});

test("laps and minutes read naturally", () => {
  assert.equal(C.volumeLabel(offer({ unit: "tours", quantity: 10, bonus: 0, sessionMinutes: null })), "10 tours");
  assert.equal(C.volumeLabel(offer({ unit: "minutes", quantity: 30, bonus: 0, sessionMinutes: null })), "30 minutes");
  assert.equal(C.bonusLabel(offer({ unit: "tours", quantity: 10, bonus: 2 })), "10 + 2 offerts");
});

test("a blank offer and a nameless one are refused", () => {
  assert.equal(C.offerIssues(C.blankOffer("famille"))[0].field, "name");
  assert.equal(C.normalizeOffer({ price: 100 }), null, "no name, not an offer");
});

test("normalising repairs what it can and drops what it cannot", () => {
  const out = C.normalizeCatalog({ offers: [
    { id: "a", name: "  Ok  ", price: "150", color: "not-a-colour", kind: "weird", extras: ["x", "", 42, "y"] },
    { name: "" },
    { id: "a", name: "Dup", price: 1 },
  ] });
  assert.equal(out.offers.length, 2, "the nameless one is dropped");
  const [a, b] = out.offers;
  assert.equal(a.name, "Ok");
  assert.equal(a.price, 150);
  assert.equal(a.color, "#d8ff35", "a bad colour falls back");
  assert.equal(a.kind, "autre", "an unknown type falls back");
  assert.deepEqual(a.extras, ["x", "y"]);
  assert.notEqual(b.id, "a", "two offers never share an id");
});

test("changing a blank's type carries sensible defaults", () => {
  const fam = C.blankOffer("famille");
  assert.equal(fam.basis, "groupe"); assert.equal(fam.people, 4);
  assert.equal(C.blankOffer("abonnement").period, "mois");
});

test("a session price is one session of n minutes, per pilot, and needs a real price", () => {
  const s = C.sessionOffer(8, 100, "Tour de chauffe inclus");
  assert.deepEqual(C.offerIssues(s), []);
  assert.equal(C.sessionLength(s), 8);
  assert.equal(s.name, "Session 8 min");
  assert.match(C.perMinuteLabel(C.sessionOffer(16, 200)), /12,5 DH la minute/);
  assert.ok(C.offerIssues(C.sessionOffer(8, 0)).some((i) => i.field === "price"), "0 DH is refused");
  // Normalising never turns a session into a group or monthly offer.
  const n = C.normalizeOffer({ ...s, basis: "groupe", people: 4, period: "mois" });
  assert.equal(n.basis, "personne");
  assert.equal(n.period, "unique");
  assert.equal(C.KIND_ORDER[C.KIND_ORDER.length - 1], "session", "shown last on the page");
});
