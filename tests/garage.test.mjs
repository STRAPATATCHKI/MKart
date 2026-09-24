// Garage, run against the real lib/fuel-store.ts and lib/garage-parts.ts: fuel burned by each
// real race, the live stock from the morning reading, and the spare-parts shelf.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = async (file) => {
  const src = readFileSync(new URL(`../lib/${file}`, import.meta.url), "utf8");
  // A module loaded from a data: URL has no folder: point its relative import at the real file.
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace('"./fuel-rules.mjs"', JSON.stringify(new URL("../lib/fuel-rules.mjs", import.meta.url).href));
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const F = await load("fuel-store.ts");
const G = await load("garage-parts.ts");

const settings = { ...F.DEFAULT_FUEL_SETTINGS, juniorLph: 2.4, gtLph: 10, juniorKartNumbers: [1, 2] };
const at = (h, m = 0) => new Date(2026, 8, 24, h, m).getTime() / 1000;
const race = (raceId, start, end, racers, name = "SESSION") => ({ raceId, name, state: "FINISHED", startedAt: start, finishedAt: end, savedAt: end, durationS: 480, racers });
const racer = (kart, laps) => ({ driver: `K${kart}`, kart, transponder: `T${kart}`, position: 1, laps, lastLapMs: 30000, bestLapMs: 30000 });

test("a race burns its real duration x each kart that drove, junior and GT at their own rate", () => {
  // 12 minutes, junior kart 1 + GT karts 7 and 8, kart 9 never lapped.
  const r = F.raceFuel(race("R1", at(20, 0), at(20, 12), [racer(1, 20), racer(7, 21), racer(8, 19), racer(9, 0)]), settings);
  assert.deepEqual([r.juniorKarts, r.gtKarts, r.minutes], [1, 2, 12]);
  assert.equal(r.litres, Math.round((2.4 + 2 * 10) * 0.2 * 100) / 100);   // 4.48 L
});

test("simulations burn nothing, and the booked duration stands in when the chrono has no times", () => {
  assert.equal(F.raceFuel(race("S", at(20), at(20, 8), [racer(7, 5)], "[SIM] demo"), settings), null);
  const r = F.raceFuel({ ...race("R", null, null, [racer(7, 5)]), durationS: 600 }, settings);
  assert.equal(r.minutes, 10);
});

test("the stock falls with every race and free run after the morning reading, not the ones before it", () => {
  const day = { date: "2026-09-24", openingL: 100, refillL: 20, measuredAt: new Date(2026, 8, 24, 10, 0).toISOString(), updatedAt: "" };
  const fuel = {
    races: [
      { raceId: "before", at: new Date(2026, 8, 24, 9, 0).getTime(), litres: 5 },
      { raceId: "after", at: new Date(2026, 8, 24, 15, 0).getTime(), litres: 4.5 },
    ],
    runs: [{ start: new Date(2026, 8, 24, 16, 0).getTime(), litres: 0.5 }],
  };
  assert.deepEqual(F.liveFuelStock(day, fuel), { stockL: 115, burnedL: 5 });
  assert.deepEqual(F.liveFuelStock(null, fuel), { stockL: 0, burnedL: 0 });
});

test("a kart going round outside a race burns from its first pass to its last, plus one lap", () => {
  const t = new Date(2026, 8, 24, 18, 0).getTime() / 1000;
  // Kart 7 (GT, 10 L/h): 5 passes over 2 minutes = 4 laps of 30 s, plus the lap before = 2.5 min.
  const run = F.stintFuel({ transponder: "T7", kart: 7, start: t, end: t + 120, passes: 5 }, settings);
  assert.equal(run.minutes, 2.5);
  assert.equal(run.litres, Math.round(10 * (150 / 3600) * 100) / 100);
  assert.equal(F.stintFuel({ transponder: "T7", kart: 7, start: t, end: t, passes: 1 }, settings), null, "one pass is not a run");
  const junior = F.stintFuel({ transponder: "T1", kart: 1, start: t, end: t + 60, passes: 3 }, settings);
  assert.equal(junior.junior, true);
  const day = F.dayFuel([race("R1", t - 3600, t - 3000, [racer(7, 10)])], [{ transponder: "T7", kart: 7, start: t, end: t + 120, passes: 5 }], settings, "2026-09-24");
  assert.equal(day.races.length, 1);
  assert.equal(day.runs.length, 1);
  assert.equal(day.totalL, Math.round((day.racesL + day.freeL) * 100) / 100);
});

test("junior kart numbers are read the ways people type them", () => {
  assert.deepEqual(F.parseKartList("1, 2 3;4, 2, x"), [1, 2, 3, 4]);
});

test("parts: a delivery adds, a kart repair takes out and is logged against the kart", () => {
  let g = { version: 1, parts: [{ ...G.blankPart(), id: "brake", name: "Plaquettes", stock: 0, minStock: 2, unit: "jeu" }], moves: [] };
  g = G.applyMove(g, { partId: "brake", qty: 5, kart: null, note: "livraison", by: "YB" });
  g = G.applyMove(g, { partId: "brake", qty: -1, kart: 7, note: "usées", by: "YB" });
  assert.equal(g.parts[0].stock, 4);
  assert.deepEqual(G.kartHistory(g, 7).map((m) => [m.partName, m.qty]), [["Plaquettes", -1]]);
  assert.equal(g.moves[0].qty, -1, "newest first");
});

test("parts: taking out more than the shelf holds is refused, and low stock is flagged", () => {
  const g = { version: 1, parts: [{ ...G.blankPart(), id: "plug", name: "Bougie", stock: 1, minStock: 2 }], moves: [] };
  assert.match(G.applyMove(g, { partId: "plug", qty: -3, kart: 1, note: "", by: null }), /Stock insuffisant/);
  assert.deepEqual(G.toReorder(g.parts).map((p) => p.id), ["plug"]);
});

test("parts: the value of the shelf counts priced parts and says how many have no price", () => {
  const parts = [
    { ...G.blankPart(), name: "A", stock: 2, unitPrice: 150 },
    { ...G.blankPart(), name: "B", stock: 3, unitPrice: null },
    { ...G.blankPart(), name: "C", stock: 0, unitPrice: 999 },
  ];
  assert.deepEqual(G.stockValue(parts), { value: 300, unpriced: 1 });
});

test("parts: a saved file is checked before it is trusted", () => {
  const g = G.normalizeGarage({ parts: [{ id: "x", name: "  Chaîne ", category: "bogus", stock: -3, minStock: "2" }, { name: "" }], moves: [{ partId: "x", qty: 0 }] });
  assert.equal(g.parts.length, 1);
  assert.deepEqual([g.parts[0].name, g.parts[0].category, g.parts[0].stock, g.parts[0].minStock], ["Chaîne", "autre", 0, 2]);
  assert.equal(g.moves.length, 0);
  assert.ok(G.SEED_GARAGE.parts.length > 5 && G.SEED_GARAGE.parts.every((p) => p.stock === 0));
});
