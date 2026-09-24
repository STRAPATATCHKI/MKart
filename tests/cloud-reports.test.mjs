// What the manager's app will read in Firebase (/reports), built by the real
// tools/apex-bridge/report-docs.mjs: revenue exactly as the till recorded it, no contact
// details, deleted reservations gone, races lap by lap, and only changes re-sent.
import { strict as assert } from "node:assert";
import test from "node:test";
import * as R from "../tools/apex-bridge/report-docs.mjs";

const NOW = new Date(2026, 8, 24, 18, 0);
const at = (day, hour) => new Date(2026, 8, day, hour, 0).toISOString();
const pilot = (name) => ({ id: name, fullName: name, kartColor: "blue", kartNumber: null });
const res = (code, over = {}) => ({
  id: code, code, channel: "enligne", contactName: "Karim Benali", phone: "0611111111", email: "k@b.ma",
  raceType: "Course", pilots: [pilot("Karim Benali")], paymentMethod: "Espèces", status: "EN_ATTENTE",
  note: null, createdAt: at(24, 10), paidAt: null, paidBy: null, paidAmount: null, sessionId: null, ...over,
});

test("payments and day totals follow the till: exact amounts, cash and card apart", () => {
  const r = R.buildReports([
    res("MK-1", { status: "PAYEE", paidAt: at(24, 11), paidAmount: 300, paymentMethod: "Espèces", paidBy: "YB" }),
    res("MK-2", { status: "EN_PISTE", paidAt: at(24, 12), paidAmount: 450, paymentMethod: "Carte bancaire" }),
    res("MK-3"),
  ], [], NOW);
  assert.deepEqual(Object.keys(r.payments), ["MK-1", "MK-2"]);
  assert.equal(r.payments["MK-1"].method, "cash");
  assert.equal(r.payments["MK-2"].method, "card");
  const day = r.days["2026-09-24"];
  assert.deepEqual([day.total, day.cash, day.card, day.count], [750, 300, 450, 2]);
  assert.equal(r.today.total, 750);
  assert.equal(r.today.waiting, 1);
});

test("nothing personal beyond names leaves the PC", () => {
  const r = R.buildReports([res("MK-1", { status: "PAYEE", paidAt: at(24, 11), paidAmount: 300 })],
    [{ queueCode: "MK-1", code: "AZSM", packLabel: "Gold", packTotalMad: 600, phone: "0622", signature: "data:image/png;base64,xx" }], NOW);
  const all = JSON.stringify(r);
  for (const secret of ["0611111111", "k@b.ma", "0622", "data:image"]) assert.ok(!all.includes(secret), secret);
  assert.equal(r.reservations["MK-1"].clientCode, "AZSM");
  assert.equal(r.payments["MK-1"].pack, "Gold");
});

test("an amount from before the till asked for it is estimated from the pack, and flagged", () => {
  const r = R.buildReports([res("MK-1", { status: "PAYEE", paidAt: at(24, 11), paidAmount: null })],
    [{ queueCode: "MK-1", packLabel: "Gold", packTotalMad: 600 }], NOW);
  assert.equal(r.payments["MK-1"].amount, 600);
  assert.equal(r.payments["MK-1"].estimated, true);
  assert.equal(r.days["2026-09-24"].estimated, 1);
});

test("a pack corrected at the counter wins over the phone's", () => {
  const r = R.buildReports([res("MK-1", { packOverride: { label: "Pack Famille", total: 400 } })],
    [{ queueCode: "MK-1", packLabel: "Gold", packTotalMad: 600 }], NOW);
  assert.equal(r.reservations["MK-1"].pack, "Pack Famille");
  assert.equal(r.reservations["MK-1"].expectedAmount, 400);
});

test("deleted and cancelled reservations are not reported, nor counted as revenue", () => {
  const r = R.buildReports([
    res("MK-1", { status: "SUPPRIMEE", paidAt: at(24, 11), paidAmount: 300 }),
    res("MK-2", { status: "ANNULEE" }),
  ], [], NOW);
  assert.deepEqual(Object.keys(r.reservations), []);
  assert.deepEqual(Object.keys(r.payments), []);
});

test("a race is sent lap by lap, in finishing order, with its winner and best lap", () => {
  const t = new Date(2026, 8, 24, 16, 0).getTime() / 1000;
  const doc = R.raceDoc({
    raceId: "20260924-003", name: "SESSION 1", state: "FINISHED", startedAt: t - 480, finishedAt: t, durationS: 480, savedAt: t,
    racers: [
      { driver: "Sofia", kart: 4, position: 2, laps: 5, bestLapMs: 30100, lastLapMs: 31000, lapTimesMs: [31000, 30100] },
      { driver: "Karim", kart: 2, position: 1, laps: 6, bestLapMs: 30500, lastLapMs: 30500, lapTimesMs: [30500] },
    ],
  });
  assert.equal(doc.day, "2026-09-24");
  assert.equal(doc.winner, "Karim");
  assert.deepEqual([doc.bestLapMs, doc.bestLapBy], [30100, "Sofia"]);
  assert.equal(doc.startedAt, Math.round((t - 480) * 1000));
  assert.deepEqual(doc.racers[1].lapTimesMs, [31000, 30100]);
  assert.equal(R.isSimulated({ name: "[SIM] essai" }), true);
});

test("the live race carries only the state when nothing runs", () => {
  assert.deepEqual(R.liveDoc({ state: "IDLE", drivers: [] }), { state: "IDLE" });
  const live = R.liveDoc({ state: "RUNNING", raceId: "X", raceName: "SESSION 2", drivers: [{ driver: "A", kart: 1, position: 1, laps: 2 }] });
  assert.equal(live.drivers[0].driver, "A");
});

test("only changes are sent, and what disappeared is removed", () => {
  const first = R.diffUpdates("payments", { a: { x: 1 }, b: { x: 2 } }, new Map([["old", null]]));
  assert.deepEqual(Object.keys(first.updates).sort(), ["payments/a", "payments/b", "payments/old"]);
  assert.equal(first.updates["payments/old"], null);
  const second = R.diffUpdates("payments", { a: { x: 1 }, b: { x: 3 } }, new Map(Object.entries(first.fingerprints)));
  assert.deepEqual(Object.keys(second.updates), ["payments/b"]);
});

test("the live race carries what the app needs to move karts round the circuit", () => {
  const live = R.liveDoc({ state: "RUNNING", raceId: "X", raceName: "SESSION 3", durationS: 480, trackLengthM: 300,
    drivers: [{ driver: "Saad", kart: 3, position: 1, grid: 2, color: 3, laps: 11, lastLapMs: 27414, lastPassingAt: 1790280398000 }] });
  assert.equal(live.drivers[0].lastPassingAt, 1790280398000);
  assert.equal(live.drivers[0].color, 3);
  assert.equal(live.drivers[0].grid, 2);
  assert.equal(live.durationMs, 480000);
  assert.equal(live.trackLengthM, 300);
});

test("the circuit is the drawn one, or the dashboard's default when none is saved", () => {
  const fallback = R.trackDoc(null);
  assert.deepEqual([fallback.width, fallback.height, fallback.points.length, fallback.start], [704, 268, 20, 13]);
  assert.equal(fallback.points[0].x, 91.8, "legacy 560-wide drawing stretched like the dashboard does");
  const drawn = R.trackDoc({ version: 2, start: 1, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }] });
  assert.deepEqual(drawn.points[0], { x: 1, y: 2 });
  assert.equal(drawn.start, 1);
});
