// The client directory, run against the real lib/client-directory.ts: people merged by phone,
// pilots added by someone else counted as clients, races joined by name, and name clashes flagged.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/client-directory.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const D = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const signup = (id, name, phone, team = [], createdAt = "2026-09-23T10:00:00Z") =>
  ({ id, code: id.slice(-4), createdAt, name, phone, email: null, age: 30, color: 2, team, status: "new", waiver: true, offers: false });
const race = (raceId, racers, name = "Race 1", finishedAt = 1790000000) =>
  ({ raceId, name, state: "FINISHED", startedAt: finishedAt - 480, finishedAt, savedAt: finishedAt, durationS: 480, racers });
const racer = (driver, laps, best, position = 1, kart = 2) =>
  ({ driver, kart, transponder: "T", position, laps, lastLapMs: best, bestLapMs: best, lapTimesMs: Array.from({ length: laps }, () => best) });

test("the same phone across two sign-ups is one client", () => {
  const out = D.buildDirectory([signup("C-1", "Mohamed Alaoui", "0612345678"), signup("C-2", "mohamed alaoui", "+212 6 12 34 56 78", [], "2026-09-24T10:00:00Z")], []);
  assert.equal(out.length, 1);
  assert.equal(out[0].signups.length, 2);
});

test("a pilot added by someone else is a client too, and says who added them", () => {
  const out = D.buildDirectory([signup("C-1", "Karim Benali", "0611111111", [{ name: "Sofia Berrada", phone: "0622222222", age: 28, color: 6 }])], []);
  const sofia = out.find((c) => c.name === "Sofia Berrada");
  assert.ok(sofia);
  assert.equal(sofia.signups[0].registrant, false);
  assert.equal(sofia.signups[0].by, "Karim Benali");
});

test("races are joined by name, ignoring case, accents and spacing", () => {
  const out = D.buildDirectory([signup("C-1", "Méhdi  Slaoui", "0633333333")], [race("R1", [racer("MEHDI SLAOUI", 8, 24234)])]);
  assert.equal(out[0].races.length, 1);
  assert.equal(out[0].totalLaps, 8);
  assert.equal(out[0].bestLapMs, 24234);
});

test("the best lap is the best across every race", () => {
  const out = D.buildDirectory([signup("C-1", "Ali Test", "0644444444")],
    [race("R1", [racer("Ali Test", 5, 26000)], "A", 1790000000), race("R2", [racer("Ali Test", 7, 24500)], "B", 1790001000)]);
  assert.equal(out[0].bestLapMs, 24500);
  assert.equal(out[0].races[0].raceId, "R2", "newest race first");
});

test("simulated races are never a client's result", () => {
  const out = D.buildDirectory([signup("C-1", "Ali Test", "0644444444")], [race("S1", [racer("Ali Test", 60, 10000)], "[SIM] Demo")]);
  assert.equal(out[0].races.length, 0);
});

test("two different clients with one name are flagged, not silently merged", () => {
  const out = D.buildDirectory([signup("C-1", "Pilote 1", "0655555555"), signup("C-2", "Pilote 1", "0666666666")],
    [race("R1", [racer("Pilote 1", 4, 25000)])]);
  assert.equal(out.length, 2, "different phones are different people");
  for (const c of out) { assert.equal(c.sameName, 1); assert.equal(c.races.length, 1); }
});

test("filters and search", () => {
  const out = D.buildDirectory([signup("C-1", "Ali Test", "0644444444"), signup("C-2", "Nadia Idrissi", "0677777777")],
    [race("R1", [racer("Ali Test", 3, 25000)])]);
  assert.deepEqual(D.filterClients(out, "roule", "").map((c) => c.name), ["Ali Test"]);
  assert.deepEqual(D.filterClients(out, "attente", "").map((c) => c.name), ["Nadia Idrissi"]);
  assert.deepEqual(D.filterClients(out, "tous", "idrissi").map((c) => c.name), ["Nadia Idrissi"]);
  assert.deepEqual(D.filterClients(out, "tous", "77 77").map((c) => c.name), ["Nadia Idrissi"], "phone digits");
});
