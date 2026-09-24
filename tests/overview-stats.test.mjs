// Vue générale, run against the real lib/overview-stats.ts: money by day and by method, what
// happens to reservations cashed before amounts were recorded, and today's reservation rows.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/overview-stats.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const S = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

// Local times, so the tests mean the same thing in any timezone.
const NOW = new Date(2026, 8, 24, 18, 0);
const at = (day, hour) => new Date(2026, 8, day, hour, 0).toISOString();

const res = (code, over = {}) => ({
  id: code, code, channel: "enligne", contactName: "Karim Benali", phone: "0611111111", email: null,
  raceType: "Course", pilots: [{ id: "a", fullName: "Karim Benali", kartColor: "blue", kartNumber: null }],
  paymentMethod: "Espèces", status: "EN_ATTENTE", note: null, createdAt: at(24, 10), paidAt: null, paidBy: null,
  paidAmount: null, sessionId: null, ...over,
});
const signup = (queueCode, packLabel, packTotalMad, createdAt = at(24, 9)) =>
  ({ id: "S" + queueCode, code: queueCode.slice(-4), createdAt, name: "X", phone: "", email: null, birthdate: "", age: 30,
     waiver: true, offers: false, status: "assigned", queueCode, packLabel, packTotalMad });

test("money is split by method, and only paid reservations count", () => {
  const rs = [
    res("A", { status: "PAYEE", paidAt: at(24, 11), paidAmount: 300, paymentMethod: "Espèces" }),
    res("B", { status: "EN_PISTE", paidAt: at(24, 12), paidAmount: 450, paymentMethod: "Carte bancaire" }),
    res("C", { status: "EN_ATTENTE" }),
    res("D", { status: "ANNULEE", paidAt: null }),
  ];
  const day = S.moneyByDay(rs, [], ["2026-09-24"]).get("2026-09-24");
  assert.equal(day.total, 750);
  assert.equal(day.cash, 300);
  assert.equal(day.card, 450);
  assert.equal(day.count, 2);
});

test("an old payment with no amount falls back to its pack, and is flagged as estimated", () => {
  const rs = [res("A", { status: "PAYEE", paidAt: at(24, 11), paidAmount: undefined })];
  const day = S.moneyByDay(rs, [signup("A", "Gold", 700)], ["2026-09-24"]).get("2026-09-24");
  assert.equal(day.total, 700);
  assert.equal(day.estimated, 1);
  assert.equal(day.unknown, 0);
});

test("a payment with neither an amount nor a pack is counted as unknown, not as zero revenue", () => {
  const rs = [res("A", { status: "PAYEE", paidAt: at(24, 11) })];
  const day = S.moneyByDay(rs, [], ["2026-09-24"]).get("2026-09-24");
  assert.equal(day.total, 0);
  assert.equal(day.unknown, 1);
  assert.equal(day.count, 1);
});

test("a sale belongs to the local day it was cashed, not the day it was booked", () => {
  const rs = [res("A", { createdAt: at(23, 20), status: "PAYEE", paidAt: at(24, 9), paidAmount: 100 })];
  const days = S.lastDays(2, NOW);
  const m = S.moneyByDay(rs, [], days);
  assert.equal(m.get(days[0]).total, 0);
  assert.equal(m.get(days[1]).total, 100);
});

test("today's summary: pilots, waiting reservations and what they should bring", () => {
  const two = [{ id: "a", fullName: "A" }, { id: "b", fullName: "B" }];
  const rs = [
    res("A", { pilots: two, status: "EN_ATTENTE" }),
    res("B", { status: "PAYEE", paidAt: at(24, 11), paidAmount: 150 }),
    res("C", { createdAt: at(23, 15), status: "TERMINEE", paidAt: at(23, 15), paidAmount: 100 }),
  ];
  const t = S.todaySummary(rs, [signup("A", "Duo", 280)], [], NOW);
  assert.equal(t.pilotsToday, 3);
  assert.equal(t.pilotsYesterday, 1);
  assert.equal(t.waiting, 1);
  assert.equal(t.waitingExpected, 280);
  assert.equal(t.money.total, 150);
  assert.equal(t.yesterday.total, 100);
  assert.equal(S.changeVs(t.money.total, t.yesterday.total), "+50 %");
});

test("change against yesterday says NEW or — rather than dividing by zero", () => {
  assert.equal(S.changeVs(200, 0), "NEW");
  assert.equal(S.changeVs(0, 0), "—");
  assert.equal(S.changeVs(50, 100), "-50 %");
});

test("the chart axis tops out on a round figure", () => {
  assert.equal(S.niceCeil(0), 0);
  assert.equal(S.niceCeil(730), 1000);
  assert.equal(S.niceCeil(1800), 2000);
  assert.equal(S.niceCeil(2100), 2500);
  assert.equal(S.niceCeil(4000), 5000);
  assert.equal(S.shortDh(15000), "15k");
  assert.equal(S.shortDh(2500), "2,5k");
  assert.equal(S.shortDh(800), "800");
});

test("pack sales group by the pack chosen at sign-up; counter sales have their own line", () => {
  const rs = [
    res("A", { status: "PAYEE", paidAt: at(24, 11), paidAmount: 700 }),
    res("B", { status: "PAYEE", paidAt: at(24, 12), paidAmount: 700 }),
    res("C", { channel: "guichet", status: "PAYEE", paidAt: at(24, 13), paidAmount: 150 }),
  ];
  const out = S.packSales(rs, [signup("A", "Gold", 700), signup("B", "Gold", 700)], ["2026-09-24"]);
  assert.deepEqual(out.map((r) => [r.label, r.count, r.amount]), [["Gold", 2, 1400], ["Sans formule (guichet)", 1, 150]]);
});

test("today's reservations: waiting people first, cancelled ones left out, expected amount marked", () => {
  const rs = [
    res("A", { status: "PAYEE", paidAt: at(24, 11), paidAmount: 300, createdAt: at(24, 9) }),
    res("B", { status: "EN_ATTENTE", createdAt: at(24, 14) }),
    res("C", { status: "ANNULEE" }),
    res("D", { status: "EN_ATTENTE", createdAt: at(20, 14) }),
  ];
  const rows = S.todayBookings(rs, [signup("B", "Silver", 400)], NOW);
  assert.deepEqual(rows.map((r) => r.code), ["B", "A"]);
  assert.equal(rows[0].status, "À encaisser");
  assert.equal(rows[0].amount, 400);
  assert.equal(rows[0].estimated, true);
  assert.equal(rows[0].pack, "Silver");
  assert.equal(rows[1].status, "Confirmée");
  assert.equal(rows[1].estimated, false);
  assert.equal(rows[1].payment, "Espèces");
});

test("today's best laps: one line per driver, fastest first, simulations left out", () => {
  const t = Math.floor(new Date(2026, 8, 24, 16, 0).getTime() / 1000);
  const race = (raceId, name, racers) => ({ raceId, name, state: "FINISHED", startedAt: t, finishedAt: t, savedAt: t, durationS: 480, racers });
  const r = (driver, bestLapMs, kart = 2) => ({ driver, kart, transponder: "T", position: 1, laps: 5, lastLapMs: bestLapMs, bestLapMs });
  const out = S.bestLapsToday([
    race("R1", "Course 1", [r("Karim", 31000), r("Sofia", 29500)]),
    race("R2", "Course 2", [r("karim", 30000)]),
    race("R3", "[SIM] test", [r("Robot", 10000)]),
  ], NOW);
  assert.deepEqual(out.map((b) => [b.driver, b.bestLapMs]), [["Sofia", 29500], ["karim", 30000]]);
});

test("a payment made two ways counts its cash part as cash and its card part as card", () => {
  const rs = [res("A", { status: "PAYEE", paidAt: at(24, 11), paidAmount: 300, paymentMethod: "Espèces", paidSplit: { cash: 200, card: 100 } })];
  const day = S.moneyByDay(rs, [], ["2026-09-24"]).get("2026-09-24");
  assert.deepEqual([day.total, day.cash, day.card], [300, 200, 100]);
});

test("a deleted reservation never counts as revenue, even one that had been paid (tests, mistakes)", () => {
  const rs = [
    res("REAL", { status: "PAYEE", paidAt: at(24, 11), paidAmount: 300 }),
    res("TEST", { status: "SUPPRIMEE", deletedFrom: "PAYEE", paidAt: at(24, 12), paidAmount: 500 }),
  ];
  const day = S.moneyByDay(rs, [], ["2026-09-24"]).get("2026-09-24");
  assert.deepEqual([day.total, day.count], [300, 1]);
  assert.deepEqual(S.todayBookings(rs, [], NOW).map((b) => b.code), ["REAL"]);
  assert.equal(S.packSales(rs, [], ["2026-09-24"]).reduce((n, p) => n + p.amount, 0), 300);
});
